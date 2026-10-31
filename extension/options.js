const t = (key, ...args) => chrome.i18n.getMessage(key, args.map(String)) || key;
const DEFAULTS = {
  provider: 'deepseek', dsKey: '', dsModel: 'deepseek-flash',
  gmKey: '', gmModel: 'gemini-flash-latest', target: chrome.i18n.getUILanguage().toLowerCase().startsWith('zh') ? '简体中文' : 'English', thinking: false,
};
const $ = (id) => document.getElementById(id);
const FIELDS = ['provider', 'dsKey', 'dsModel', 'gmKey', 'gmModel', 'target'];

function showProvider() {
  const p = $('provider').value;
  $('ds').classList.toggle('hidden', p !== 'deepseek');
  $('gm').classList.toggle('hidden', p !== 'gemini');
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
  await chrome.storage.local.set(c);
  $('status').textContent = t('optSaved');
  setTimeout(() => ($('status').textContent = ''), 2000);
}

async function test(provider) {
  const out = provider === 'gemini' ? $('gmOut') : $('dsOut');
  const key = (provider === 'gemini' ? $('gmKey') : $('dsKey')).value.trim();
  if (!key) { out.textContent = t('optNeedKey'); return; }
  out.textContent = t('optConnecting');
  const r = await chrome.runtime.sendMessage({ type: 'listModels', provider, key });
  if (r.error) { out.textContent = t('optFailed', r.error); return; }
  if (provider === 'gemini') {
    $('gmList').innerHTML = r.models.map((m) => `<option value="${m}">`).join('');
    const flash = r.models.filter((m) => /flash/.test(m));
    out.textContent = t('optOkGemini', r.models.length, flash.slice(0, 6).join(', ') || '-');
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
