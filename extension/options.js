const t = (key, ...args) => chrome.i18n.getMessage(key, args.map(String)) || key;
const DEFAULTS = {
  provider: 'deepseek', dsKey: '', dsModel: 'deepseek-flash',
  gmKey: '', gmModel: 'gemini-flash-latest',
  cuBase: '', cuKey: '', cuModel: '',
  target: chrome.i18n.getUILanguage().toLowerCase().startsWith('zh') ? '简体中文' : 'English', thinking: false,
};
const $ = (id) => document.getElementById(id);
const FIELDS = ['provider', 'dsKey', 'dsModel', 'gmKey', 'gmModel', 'cuBase', 'cuKey', 'cuModel', 'target'];
const OUT = { deepseek: 'dsOut', gemini: 'gmOut', custom: 'cuOut' };
const KEY = { deepseek: 'dsKey', gemini: 'gmKey', custom: 'cuKey' };

function showProvider() {
  const p = $('provider').value;
  $('ds').classList.toggle('hidden', p !== 'deepseek');
  $('gm').classList.toggle('hidden', p !== 'gemini');
  $('cu').classList.toggle('hidden', p !== 'custom');
}

// "https://openrouter.ai/api/v1/" -> { base: "https://openrouter.ai/api/v1", origin: "https://openrouter.ai/*" }
// Match patterns leave the port out, so http://localhost/* also covers localhost:11434.
function parseBase(raw) {
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return { base: (u.origin + u.pathname).replace(/\/+$/, ''), origin: `${u.protocol}//${u.hostname}/*` };
}

// Must be the first await after the click: Chrome only shows the prompt during a user gesture.
// Asks for the one site the user typed, never for every site.
async function askHost() {
  const b = parseBase($('cuBase').value);
  if (!b) throw new Error(t('optBadBase'));
  const ok = await chrome.permissions.request({ origins: [b.origin] });
  if (!ok) throw new Error(t('optPermDenied', b.origin));
  return b;
}

async function load() {
  const c = { ...DEFAULTS, ...(await chrome.storage.local.get(null)) };
  for (const f of FIELDS) $(f).value = c[f];
  $('thinking').checked = !!c.thinking;
  showProvider();
}

async function save() {
  const c = {};
  for (const f of FIELDS) c[f] = $(f).value.trim();
  c.thinking = $('thinking').checked;
  if (c.provider === 'custom') {
    try {
      c.cuBase = (await askHost()).base;
      $('cuBase').value = c.cuBase;
    } catch (e) {
      $('status').textContent = e.message;
      return;
    }
  }
  await chrome.storage.local.set(c);
  $('status').textContent = t('optSaved');
  setTimeout(() => ($('status').textContent = ''), 2000);
}

async function test(provider) {
  const out = $(OUT[provider]);
  const key = $(KEY[provider]).value.trim();
  let base;
  if (provider === 'custom') {
    try { base = (await askHost()).base; } catch (e) { out.textContent = e.message; return; }
  } else if (!key) { out.textContent = t('optNeedKey'); return; }
  out.textContent = t('optConnecting');
  const r = await chrome.runtime.sendMessage({ type: 'listModels', provider, key, base });
  if (r.error) { out.textContent = t('optFailed', r.error); return; }
  if (provider === 'gemini') {
    $('gmList').innerHTML = r.models.map((m) => `<option value="${m}">`).join('');
    const flash = r.models.filter((m) => /flash/.test(m));
    out.textContent = t('optOkGemini', r.models.length, flash.slice(0, 6).join(', ') || '-');
  } else if (provider === 'custom') {
    $('cuList').replaceChildren(...r.models.map((m) => Object.assign(document.createElement('option'), { value: m.id })));
    const vision = r.models.filter((m) => m.vision).map((m) => m.id);
    out.textContent = vision.length
      ? t('optOkCustomVision', r.models.length, vision.slice(0, 8).join(', '))
      : t('optOkCustom', r.models.length, r.models.slice(0, 8).map((m) => m.id).join(', ') || '-');
  } else {
    out.textContent = t('optOk', r.models.join(', '));
  }
}

// Fill in the page's text in the browser's language.
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
document.title = t('optTitle');
$('provider').addEventListener('change', showProvider);
$('save').addEventListener('click', save);
document.querySelectorAll('[data-test]').forEach((b) => b.addEventListener('click', () => test(b.dataset.test)));
load();
