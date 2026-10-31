// Page side: find the manga pages on screen, crop them out of the screenshot,
// ask the background for translations, then lay the painted overlay over the viewport.
(() => {
  const t = (key, ...args) => chrome.i18n.getMessage(key, args.map(String)) || key;
  // After the extension is reloaded, the tab still holds the old copy of this script, cut off from
  // the extension. Only skip loading if the copy already here is still connected.
  const rt = chrome.runtime;
  const prev = window.__bubbleTranslateContent;
  if (prev && typeof prev.alive === 'function' && prev.alive()) return;
  window.__bubbleTranslateContent = { alive: () => { try { return !!rt.id; } catch { return false; } } };

  let overlay = null, busy = false, cancelled = false, toastEl = null, toastTimer = 0;

  // Our own layers (and ones an older copy of this script left behind). Old versions didn't tag
  // their elements, so also match them by the style they used.
  function isOurs(el) {
    if (el.dataset && el.dataset.bubbleTranslate) return true;
    const s = el.style || {};
    if (el.tagName === 'CANVAS' && s.zIndex === '2147483646' && s.pointerEvents === 'none') return true;
    return el.tagName === 'DIV' && s.zIndex === '2147483647' && s.position === 'fixed' && s.pointerEvents === 'none';
  }
  // Remove leftovers from older copies; returns how many were removed.
  function removeStale() {
    let n = 0;
    for (const el of Array.from(document.documentElement.children)) {
      if (el === overlay || el === toastEl || !isOurs(el)) continue;
      el.remove(); n++;
    }
    return n;
  }
  removeStale();
  const INPUT_EVENTS = ['scroll', 'wheel', 'keydown', 'mousedown', 'touchstart', 'resize'];

  function toast(text, { error = false, ms = 0 } = {}) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.dataset.bubbleTranslate = 'toast';
      toastEl.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;padding:8px 12px;border-radius:8px;' +
        'font:14px/1.4 "Microsoft YaHei",sans-serif;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none;max-width:360px';
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.background = error ? '#b3261e' : 'rgba(20,20,20,.85)';
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() { if (toastEl) toastEl.style.display = 'none'; }

  function onInput(e) {
    // Holding the shortcut's modifier keys shouldn't count as "the reader moved on".
    if (e && e.type === 'keydown' && ['Alt', 'Shift', 'Control', 'Meta'].includes(e.key)) return;
    if (busy) cancelled = true;
    clear();
  }
  function listen(on) {
    for (const ev of INPUT_EVENTS) (on ? window.addEventListener : window.removeEventListener).call(window, ev, onInput, true);
  }
  function clear() {
    if (overlay) { overlay.remove(); overlay = null; }
    removeStale();
    listen(false);
    if (busy) { cancelled = true; toast(t('toastCancelled'), { ms: 1200 }); } else hideToast();
  }

  // Big visible images / canvases are the manga pages. Falls back to the whole viewport.
  function findPages() {
    const vw = innerWidth, vh = innerHeight, found = [];
    for (const el of document.querySelectorAll('canvas, img, picture, video')) {
      if (isOurs(el)) continue; // never mistake a translation layer for a manga page
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top), x1 = Math.min(vw, r.right), y1 = Math.min(vh, r.bottom);
      const w = x1 - x0, h = y1 - y0;
      if (w < 150 || h < 200 || w * h < 0.06 * vw * vh) continue;
      found.push({ x: x0, y: y0, w, h });
    }
    // Drop rectangles that sit inside a bigger one.
    found.sort((a, b) => b.w * b.h - a.w * a.h);
    const pages = [];
    for (const r of found) {
      const inside = pages.some((p) => {
        const ix = Math.max(0, Math.min(p.x + p.w, r.x + r.w) - Math.max(p.x, r.x));
        const iy = Math.max(0, Math.min(p.y + p.h, r.y + r.h) - Math.max(p.y, r.y));
        return ix * iy > 0.7 * r.w * r.h;
      });
      if (!inside) pages.push(r);
      if (pages.length === 4) break;
    }
    if (!pages.length) pages.push({ x: 0, y: 0, w: vw, h: vh });
    return pages.sort((a, b) => b.x - a.x || a.y - b.y); // right page first
  }

  function loadImage(src) {
    return new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
  }

  // The page as the model sees it, plus a copy with our detected bubbles outlined and numbered.
  function crop(shot, r, bubbles) {
    const MAX = 1600;
    const s = Math.min(1, MAX / Math.max(r.w, r.h));
    const c = document.createElement('canvas');
    c.width = Math.round(r.w * s); c.height = Math.round(r.h * s);
    const ctx = c.getContext('2d');
    ctx.drawImage(shot, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    const image = c.toDataURL('image/jpeg', 0.9);
    if (!bubbles.length) return { image };
    BubbleTranslate.markBubbles(ctx, bubbles, r, s);
    return { image, marked: c.toDataURL('image/jpeg', 0.9) };
  }

  async function run(shotUrl, tStart) {
    busy = true; cancelled = false;
    listen(true);
    const tRun = Date.now();
    try {
      const pages = findPages();
      toast(t('toastWorking', pages.length));
      const img = await loadImage(shotUrl);
      const shot = document.createElement('canvas');
      shot.width = img.width; shot.height = img.height;
      shot.getContext('2d').drawImage(img, 0, 0);
      const k = img.width / innerWidth;
      const data = shot.getContext('2d').getImageData(0, 0, shot.width, shot.height).data;
      const regions = pages.map((p) => {
        const rect = { x: Math.round(p.x * k), y: Math.round(p.y * k), w: Math.round(p.w * k), h: Math.round(p.h * k) };
        rect.w = Math.min(rect.w, shot.width - rect.x); rect.h = Math.min(rect.h, shot.height - rect.y);
        const blocks = BubbleTranslate.textBlocks(data, shot.width, rect, k);
        // A real bubble holds at least one block of lettering; white walls, doors and windows don't.
        // Fewer false outlines also means fewer wrong numbers for the model to pick.
        const bubbles = BubbleTranslate.detect(data, shot.width, rect, k).filter((b) => blocks.some((t) => {
          const cx = (t.x0 + t.x1) / 2, cy = (t.y0 + t.y1) / 2;
          return cx > b.x0 && cx < b.x1 && cy > b.y0 && cy < b.y1;
        }));
        return { rect, bubbles, blocks };
      });
      const title = document.title.slice(0, 80);
      const tModel = Date.now();
      const results = await Promise.all(regions.map((r) =>
        chrome.runtime.sendMessage({ type: 'translate', ...crop(shot, r.rect, r.bubbles), title })));
      const tDraw = Date.now();
      if (cancelled) return;
      const err = results.find((r) => r && r.error);
      if (err && results.every((r) => !r || r.error)) throw new Error(err.error);
      regions.forEach((r, i) => { r.items = (results[i] && results[i].items) || []; });
      const n = regions.reduce((a, r) => a + r.items.length, 0);
      const painted = BubbleTranslate.render(shot, regions, { k });
      painted.style.cssText = `position:fixed;left:0;top:0;width:${innerWidth}px;height:${innerHeight}px;` +
        'z-index:2147483646;pointer-events:none';
      painted.dataset.bubbleTranslate = 'overlay';
      if (overlay) overlay.remove();
      overlay = painted;
      removeStale();
      document.documentElement.appendChild(overlay);
      // Where the time went, so slow runs can be diagnosed (also kept on the page for debugging).
      const s = (ms) => (ms / 1000).toFixed(1);
      const tEnd = Date.now(), t0 = tStart || tRun;
      const think = results.some((r) => r && r.thinking);
      const detail = `${t('tCapture')} ${s(tRun - t0)} · ${t('tDetect')} ${s(tModel - tRun)} · ${t('tModel')} ${s(tDraw - tModel)} · ${t('tDraw')} ${s(tEnd - tDraw)}${think ? ' · ' + t('tThinking') : ''}`;
      document.documentElement.dataset.bubbleTranslateTiming = `${s(tEnd - t0)}s | ${detail}`;
      toast(n ? t('toastDone', n, s(tEnd - t0), detail) : t('toastNone'), { ms: 5000, error: !n });
    } finally {
      busy = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === 'state') {
      // Clear leftovers before the screenshot is taken, and wait for the page to repaint without them.
      const removed = removeStale();
      const send = () => reply({ active: !!overlay, busy });
      if (!removed) { send(); return; }
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(send, 50)));
      return true;
    }
    if (msg.type === 'clear') { clear(); reply({}); return; }
    if (msg.type === 'toast') { toast(msg.text, { error: msg.error, ms: 4000 }); reply({}); return; }
    if (msg.type === 'run') {
      run(msg.shot, msg.t0).catch((e) => { listen(false); toast(t('toastError', e.message || e), { error: true, ms: 8000 }); });
      reply({});
    }
  });
})();
