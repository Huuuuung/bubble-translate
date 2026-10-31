// Takes the screenshot and calls the model. The page side (content.js + render.js) does the rest.
const t = (key, ...args) => chrome.i18n.getMessage(key, args.map(String)) || key;
const DEFAULTS = {
  provider: 'deepseek',
  dsKey: '', dsModel: 'deepseek-flash',
  gmKey: '', gmModel: 'gemini-flash-latest',
  target: chrome.i18n.getUILanguage().toLowerCase().startsWith('zh') ? '简体中文' : 'English',
  thinking: false,
};
const cfg = async () => ({ ...DEFAULTS, ...(await chrome.storage.local.get(null)) });

async function trigger(tab) {
  const t0 = Date.now();
  if (!tab || !tab.id) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['render.js', 'content.js'] });
  } catch (e) {
    console.warn('cannot run on this page', e);
    return;
  }
  const state = await chrome.tabs.sendMessage(tab.id, { type: 'state' });
  if (state && (state.active || state.busy)) {
    await chrome.tabs.sendMessage(tab.id, { type: 'clear' });
    return;
  }
  const c = await cfg();
  if (!(c.provider === 'gemini' ? c.gmKey : c.dsKey)) {
    chrome.tabs.sendMessage(tab.id, { type: 'toast', text: t('toastNoKey'), error: true });
    chrome.runtime.openOptionsPage();
    return;
  }
  const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  chrome.tabs.sendMessage(tab.id, { type: 'run', shot, t0 });
}

chrome.commands.onCommand.addListener((cmd, tab) => { if (cmd === 'translate-view') trigger(tab); });
chrome.action.onClicked.addListener((tab) => trigger(tab));

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'translate') {
    cfg().then((c) => translate(msg).then(
      (items) => reply({ items, thinking: !!c.thinking }),
      (e) => reply({ error: String(e.message || e) })));
    return true;
  }
  if (msg.type === 'listModels') {
    listModels(msg.provider, msg.key).then((m) => reply({ models: m }), (e) => reply({ error: String(e.message || e) }));
    return true;
  }
});

// marked: a second image of the same page with detected balloons outlined in red and numbered.
// Models are poor at exact coordinates but good at reading a number, so the number decides placement.
function prompt(target, title, yFirst, marked) {
  const boxSpec = yFirst
    ? '"box_2d": [ymin, xmin, ymax, xmax]'
    : '"box": [x0, y0, x1, y1] (x0,y0 = top-left, x1,y1 = bottom-right)';
  const boxKey = yFirst ? '"box_2d":[...]' : '"box":[...]';
  const page = `one page of a Japanese manga${title ? ` (from the web page "${title}")` : ''}`;
  const find = 'Find every piece of dialogue and narration text: speech bubbles, caption boxes, and hand-written lines next to characters. Skip sound effects drawn as part of the art, tiny furigana, page numbers and website UI.';
  const tr = `"src": the original text, and "tr": a natural, spoken ${target} translation suited to manga dialogue. Keep names consistent and translate the meaning, not word by word.`;
  const order = 'Order the items the way a reader reads them: right to left, top to bottom.';
  if (marked) {
    return `Image 1 is ${page}. Image 2 is the same page with the speech balloons we detected outlined in red and numbered.
${find} Read the text from image 1, which is clean; use image 2 only to look up the numbers.
For each one give:
- "bubble": the red number of the outline that contains this text, or 0 if the text is not inside any numbered outline (some outlines are false detections with no text; just never use them);
- ${boxSpec} around the text, normalized to 0-1000 of the image;
- ${tr}
${order}
Reply with compact JSON only: {"items":[{"bubble":0,${boxKey},"src":"...","tr":"..."}]}`;
  }
  return `This is ${page}.
${find}
For each one give its bounding box as ${boxSpec}, with coordinates normalized to 0-1000 relative to this image. The box must enclose all of that text's characters.
Also give ${tr}
${order}
Reply with JSON only: {"items":[{${boxKey},"src":"...","tr":"..."}]}`;
}

function parseItems(text, yFirst) {
  const clean = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const j = JSON.parse(clean);
  const arr = Array.isArray(j) ? j : j.items || [];
  return arr
    .map((it) => {
      let box = it.box;
      if (yFirst || (!box && it.box_2d)) {
        const [ymin, xmin, ymax, xmax] = it.box_2d || [];
        box = [xmin, ymin, xmax, ymax];
      }
      const okBox = Array.isArray(box) && box.length === 4 && box.every((v) => Number.isFinite(Number(v)));
      return { bubble: Number(it.bubble) || 0, box: okBox ? box : null, src: it.src || it.ja || '', tr: it.tr || it.zh || '' };
    })
    .filter((it) => it.tr && (it.bubble > 0 || it.box));
}

async function translate({ image, marked, title }) {
  const c = await cfg();
  const imgs = marked ? [image, marked] : [image];
  if (c.provider === 'gemini') {
    const parts = imgs.map((u) => ({ inline_data: { mime_type: 'image/jpeg', data: u.split(',')[1] } }));
    const body = (thinkingOff) => ({
      contents: [{ parts: [...parts, { text: prompt(c.target, title, true, !!marked) }] }],
      generationConfig: { responseMimeType: 'application/json', ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
    });
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.gmModel)}:generateContent`;
    const send = (b) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.gmKey }, body: JSON.stringify(b) });
    let r = await send(body(!c.thinking));
    if (r.status === 400 && !c.thinking) r = await send(body(false)); // model may not accept the thinking switch
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    return parseItems(text, true);
  }
  const body = {
    model: c.dsModel,
    messages: [{ role: 'user', content: [
      ...imgs.map((u) => ({ type: 'image_url', image_url: { url: u } })),
      { type: 'text', text: prompt(c.target, title, false, !!marked) },
    ] }],
    response_format: { type: 'json_object' },
    ...(c.thinking ? {} : { thinking: { type: 'disabled' } }),
  };
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.dsKey}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`DeepSeek ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return parseItems(j.choices?.[0]?.message?.content || '', false);
}

async function listModels(provider, key) {
  if (provider === 'gemini') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
  }
  const r = await fetch('https://api.deepseek.com/models', { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`DeepSeek ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.data || []).map((m) => m.id + ((m.input_modalities || []).includes('image') ? t('optReadsImages') : t('optNoImages')));
}
