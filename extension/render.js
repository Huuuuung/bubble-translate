// Finds speech bubbles on the screenshot and paints translations into them.
// 1) detect(): find closed white areas that hold text (the bubbles) without any model help.
// 2) The model is shown those bubbles numbered and says which number each line belongs to.
// 3) render(): whiten each bubble's text and fit the translation inside, one font size per page.
// Lines the model puts outside any numbered bubble fall back to its own box.
(() => {
  // No "already loaded" guard: after the extension is reloaded, an open tab may still hold the old
  // version, and the new one must replace it.
  const root = typeof window !== 'undefined' ? window : globalThis;
  const FONT = '"Microsoft YaHei","PingFang SC","Noto Sans SC","Source Han Sans SC",sans-serif';
  const NO_LINE_START = '，。！？、…）」』”’,.!?)~～ー－-';
  const THR = 200; // luminance that counts as "white paper"

  const lum = (d, i) => (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;

  // Flood fill over `ok` pixels in a w*h grid. Returns the pixel list and bounding box,
  // or null once it grows past `cap`.
  // lim (optional): {x0,y0,x1,y1} inclusive bounds the fill may not leave.
  function floodGrid(ok, lab, w, h, start, id, cap, lim) {
    const L = lim || { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
    const stack = [start];
    lab[start] = id;
    const pts = [];
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    while (stack.length) {
      const p = stack.pop();
      pts.push(p);
      if (pts.length > cap) { while (stack.length) stack.pop(); return null; }
      const x = p % w, y = (p - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > L.x0 && ok[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack.push(p - 1); }
      if (x < L.x1 && ok[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack.push(p + 1); }
      if (y > L.y0 && ok[p - w] && !lab[p - w]) { lab[p - w] = id; stack.push(p - w); }
      if (y < L.y1 && ok[p + w] && !lab[p + w]) { lab[p + w] = id; stack.push(p + w); }
    }
    return { pts, x0, y0, x1, y1 };
  }

  // Inside a component's bounding box: the component plus everything it encloses.
  // Also reports the enclosed holes (glyphs, or art if this is not a bubble).
  function fillInfo(pts, x0, y0, bw, bh, w) {
    const inC = new Uint8Array(bw * bh);
    for (const p of pts) { const x = p % w, y = (p - x) / w; inC[(y - y0) * bw + (x - x0)] = 1; }
    const outside = new Uint8Array(bw * bh);
    const st = [];
    const seed = (q) => { if (!inC[q] && !outside[q]) { outside[q] = 1; st.push(q); } };
    for (let x = 0; x < bw; x++) { seed(x); seed((bh - 1) * bw + x); }
    for (let y = 0; y < bh; y++) { seed(y * bw); seed(y * bw + bw - 1); }
    while (st.length) {
      const q = st.pop(), x = q % bw, y = (q - x) / bw;
      if (x > 0) seed(q - 1); if (x < bw - 1) seed(q + 1);
      if (y > 0) seed(q - bw); if (y < bh - 1) seed(q + bw);
    }
    const mask = new Uint8Array(bw * bh);
    const hole = new Uint8Array(bw * bh);
    let filled = 0, holes = 0;
    for (let q = 0; q < bw * bh; q++) {
      if (!outside[q]) { mask[q] = 1; filled++; if (!inC[q]) { hole[q] = 1; holes++; } }
    }
    // Hole pieces: text is many small pieces, artwork is a few big ones.
    const hl = new Int32Array(bw * bh);
    let nHoles = 0, maxHole = 0;
    for (let q = 0; q < bw * bh; q++) {
      if (!hole[q] || hl[q]) continue;
      const c = floodGrid(hole, hl, bw, bh, q, ++nHoles, Infinity);
      if (c.pts.length > maxHole) maxHole = c.pts.length;
    }
    return { mask, filled, holes, nHoles, maxHole };
  }

  // data: RGBA of the whole screenshot (width W). R: page rect in screenshot px. k: px per CSS px.
  // Returns bubbles [{x0,y0,x1,y1 (screenshot px), mask (bbox-sized), fill}] in no particular order.
  function detect(data, W, R, k = 1) {
    const rx = Math.max(0, Math.round(R.x)), ry = Math.max(0, Math.round(R.y));
    const w = Math.round(R.w), h = Math.round(R.h), N = w * h;
    const white = new Uint8Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) white[y * w + x] = lum(data, ((ry + y) * W + rx + x) * 4) >= THR ? 1 : 0;
    // Thicken the ink by ~1 CSS px so hairline gaps in a bubble's outline don't leak.
    const r = Math.max(1, Math.round(k));
    const tmp = new Uint8Array(N), ok = new Uint8Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 1;
      for (let d = -r; d <= r && v; d++) { const xx = x + d; if (xx >= 0 && xx < w && !white[y * w + xx]) v = 0; }
      tmp[y * w + x] = v;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 1;
      for (let d = -r; d <= r && v; d++) { const yy = y + d; if (yy >= 0 && yy < h && !tmp[yy * w + x]) v = 0; }
      ok[y * w + x] = v;
    }
    const lab = new Int32Array(N);
    const minA = 0.003 * N, maxA = 0.25 * N, minSide = 14 * k;
    const out = [];
    let id = 0;
    for (let p = 0; p < N; p++) {
      if (!ok[p] || lab[p]) continue;
      const c = floodGrid(ok, lab, w, h, p, ++id, maxA);
      if (!c || c.pts.length < minA) continue;
      const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
      if (bw < minSide || bh < minSide || bw > 0.8 * w || bh > 0.8 * h) continue;
      const f = fillInfo(c.pts, c.x0, c.y0, bw, bh, w);
      const holeRatio = f.holes / f.filled;
      if (f.filled < 0.35 * bw * bh) continue;           // not a blob-ish shape
      if (holeRatio < 0.02 || holeRatio > 0.5) continue;  // empty, or mostly art
      if (f.nHoles < 3 || f.maxHole > 0.3 * f.filled) continue; // no text, or a big picture inside
      out.push({ x0: rx + c.x0, y0: ry + c.y0, x1: rx + c.x1, y1: ry + c.y1, mask: f.mask, bw, bh,
        fill: c.pts.length / (bw * bh), area: f.filled });
    }
    out.sort((a, b) => b.area - a.area);
    return out.slice(0, 40);
  }

  // Blocks of lettering on white paper, found without the model: small dark marks (glyph strokes)
  // ringed by white, grouped when they sit close together. This catches text in bubbles whose
  // outline is open or merges into a white background, which detect() can't close off.
  // Returns [{x0,y0,x1,y1 (screenshot px), n (marks)}].
  function textBlocks(data, W, R, k = 1) {
    const rx = Math.max(0, Math.round(R.x)), ry = Math.max(0, Math.round(R.y));
    const w = Math.round(R.w), h = Math.round(R.h), N = w * h;
    const dark = new Uint8Array(N), white = new Uint8Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const l = lum(data, ((ry + y) * W + rx + x) * 4);
      dark[y * w + x] = l < 110 ? 1 : 0;
      white[y * w + x] = l >= THR ? 1 : 0;
    }
    const lab = new Int32Array(N);
    const maxG = 28 * k, minG = 3 * k, ring = 1;
    const marks = [];
    let id = 0;
    for (let p = 0; p < N; p++) {
      if (!dark[p] || lab[p]) continue;
      const c = floodGrid(dark, lab, w, h, p, ++id, maxG * maxG);
      if (!c) continue;
      const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
      if (bw > maxG || bh > maxG || Math.max(bw, bh) < minG) continue;
      // The ring just outside the mark must be mostly white paper.
      let tot = 0, wh = 0;
      const X0 = Math.max(0, c.x0 - ring), X1 = Math.min(w - 1, c.x1 + ring);
      const Y0 = Math.max(0, c.y0 - ring), Y1 = Math.min(h - 1, c.y1 + ring);
      for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
        if (x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1) continue;
        tot++; wh += white[y * w + x];
      }
      if (!tot || wh < 0.6 * tot) continue;
      marks.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 });
    }
    // Group marks closer than a small gap (union-find).
    const gap = 7 * k, par = marks.map((_, i) => i);
    const find = (i) => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
    const order = marks.map((_, i) => i).sort((a, b) => marks[a].x0 - marks[b].x0);
    for (let a = 0; a < order.length; a++) {
      const A = marks[order[a]];
      for (let b = a + 1; b < order.length; b++) {
        const B = marks[order[b]];
        if (B.x0 - A.x1 > gap) break;
        const dy = Math.max(0, Math.max(A.y0, B.y0) - Math.min(A.y1, B.y1));
        if (dy <= gap) par[find(order[a])] = find(order[b]);
      }
    }
    const groups = new Map();
    marks.forEach((m, i) => {
      const r = find(i);
      const g = groups.get(r);
      if (!g) groups.set(r, { x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1, n: 1 });
      else { g.x0 = Math.min(g.x0, m.x0); g.y0 = Math.min(g.y0, m.y0); g.x1 = Math.max(g.x1, m.x1); g.y1 = Math.max(g.y1, m.y1); g.n++; }
    });
    const out = [];
    for (const g of groups.values()) {
      const bw = g.x1 - g.x0 + 1, bh = g.y1 - g.y0 + 1;
      if (g.n < 3 || bw > 0.5 * w || bh > 0.5 * h || Math.max(bw, bh) < 12 * k) continue;
      // Lettering sits on mostly white paper; busy artwork doesn't.
      let wh = 0;
      for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) wh += white[y * w + x];
      if (wh < 0.4 * bw * bh) continue;
      out.push({ x0: rx + g.x0, y0: ry + g.y0, x1: rx + g.x1, y1: ry + g.y1, n: g.n });
    }
    return out;
  }

  // ---------- text layout ----------
  // CJK breaks between any two characters; other scripts (English etc.) break between words.
  const CJK = '\u2E80-\u9FFF\u3000-\u303F\uAC00-\uD7AF\uFF00-\uFFEF';
  const TOKEN = new RegExp(`[^\\s${CJK}]+|\\s+|[\\s\\S]`, 'gu');
  // Outside any bubble, a short run of katakana and long marks (ザーッ, ドドド) is a sound effect
  // drawn into the art. The model sometimes returns one anyway; leave it alone.
  const SFX = /^[゠-ヿｦ-ﾟ〜～~ー―－・…！!？?s]{1,8}$/u;
  const isLatin = (text) => /[A-Za-z\u00C0-\u024F\u0400-\u04FF]{2}/.test(text);
  function layout(ctx, text, w, h, size) {
    ctx.font = `600 ${size}px ${FONT}`;
    const lines = [];
    let line = '', split = false;
    const push = (tok) => {
      if (line && ctx.measureText(line + tok).width > w && !NO_LINE_START.includes(tok[0])) {
        lines.push(line.trimEnd()); line = tok.trimStart();
      } else line += tok;
    };
    for (const tok of text.match(TOKEN) || []) {
      // A word too long for the box on its own gets broken by letter rather than sticking out.
      if (tok.length > 1 && ctx.measureText(tok).width > w) { split = true; for (const ch of tok) push(ch); }
      else push(tok);
    }
    if (line.trim()) lines.push(line.trimEnd());
    const lh = size * 1.18;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    return { lines, lh, ok: !split && lines.length * lh <= h && widest <= w * 1.08 };
  }

  // Vertical text: columns right-to-left, punctuation swapped for its vertical form.
  const VERT = { '，': '︐', ',': '︐', '。': '︒', '、': '︑', '：': '︓', '；': '︔', '“': '﹁', '”': '﹂',
    '「': '﹁', '」': '﹂', '『': '﹃', '』': '﹄', '（': '︵', '）': '︶', '(': '︵', ')': '︶',
    '…': '︙', '—': '︱', '-': '︱', 'ー': '︱', '～': '︴', '~': '︴', '!': '！', '?': '？' };
  function vlayout(text, w, h, size) {
    const chars = [...text].map((c) => VERT[c] || c);
    const step = size * 1.06, colW = size * 1.2;
    const per = Math.max(1, Math.floor(h / step));
    const cols = [];
    for (let i = 0; i < chars.length; i += per) cols.push(chars.slice(i, i + per));
    return { cols, step, colW, ok: cols.length * colW <= w * 1.05 };
  }

  function fit(fn, minSize, maxSize) {
    for (let size = maxSize; size > minSize; size -= Math.max(1, size * 0.06)) {
      const lay = fn(size);
      if (lay.ok) return { lay, size };
    }
    return { lay: fn(minSize), size: minSize, tight: true };
  }

  // Biggest size this text can take in r, and whether vertical fits better.
  function plan(ctx, text, r, minSize, maxSize) {
    const hz = fit((s) => layout(ctx, text, r.w, r.h, s), minSize, maxSize);
    // Horizontal reads best and keeps the page uniform; vertical only when horizontal gets cramped.
    const vt = r.h > 1.6 * r.w && !isLatin(text) ? fit((s) => vlayout(text, r.w, r.h, s), minSize, maxSize) : null;
    if (vt && !vt.tight && (hz.tight || vt.size > hz.size * 1.4)) return { vertical: true, size: vt.size };
    return { vertical: false, size: hz.size };
  }

  function drawText(ctx, text, r, size, vertical) {
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${size}px ${FONT}`;
    if (vertical) {
      const { cols, step, colW } = vlayout(text, r.w, r.h, size);
      const longest = Math.max(...cols.map((c) => c.length));
      const right = r.x + r.w / 2 + (cols.length * colW) / 2 - colW / 2;
      const top = r.y + r.h / 2 - (longest * step) / 2 + step / 2;
      cols.forEach((col, ci) => col.forEach((ch, i) => ctx.fillText(ch, right - ci * colW, top + i * step)));
      return;
    }
    const lay = layout(ctx, text, r.w, r.h, size);
    const cx = r.x + r.w / 2, top = r.y + r.h / 2 - (lay.lines.length * lay.lh) / 2 + lay.lh / 2;
    lay.lines.forEach((l, i) => ctx.fillText(l, cx, top + i * lay.lh));
  }

  // ---------- fallback for lines outside any detected bubble ----------
  // The model's box is only roughly placed: look for a white bubble around it.
  // Returns a bubble like detect() does, or null (text on artwork, or the white leaks into the panel).
  function bubbleAt(white, lab, W, H, box, R, state) {
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    const cap = Math.min(0.25 * R.w * R.h, 6 * bw * bh);
    const lim = { x0: Math.max(0, Math.round(R.x)), y0: Math.max(0, Math.round(R.y)),
      x1: Math.min(W - 1, Math.round(R.x + R.w) - 1), y1: Math.min(H - 1, Math.round(R.y + R.h) - 1) };
    let best = null, bestScore = 0;
    for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) {
      const x = Math.round(box.x0 + bw * (i + 0.5) / 7), y = Math.round(box.y0 + bh * (j + 0.5) / 7);
      const p = y * W + x;
      if (x < lim.x0 || y < lim.y0 || x > lim.x1 || y > lim.y1 || !white[p]) continue;
      let c;
      if (lab[p]) c = state.comps.get(lab[p]);
      else { const id = ++state.id; c = floodGrid(white, lab, W, H, p, id, cap, lim); state.comps.set(id, c); }
      if (!c) continue;
      const ix = Math.max(0, Math.min(c.x1, box.x1) - Math.max(c.x0, box.x0));
      const iy = Math.max(0, Math.min(c.y1, box.y1) - Math.max(c.y0, box.y0));
      if (ix * iy > bestScore) { bestScore = ix * iy; best = c; }
    }
    if (!best || bestScore < 0.5 * bw * bh) return null;
    const cw = best.x1 - best.x0 + 1, ch = best.y1 - best.y0 + 1;
    if (cw > 2.5 * bw + 40 || ch > 2.5 * bh + 40) return null;
    if (best.bubble === undefined) {
      // Same test as detect(): a bubble is a blob holding many small dark pieces (the glyphs).
      // A white panel background holds a few big ones (the artwork) and must not be whitened.
      const f = fillInfo(best.pts, best.x0, best.y0, cw, ch, W);
      const holeRatio = f.holes / f.filled;
      const looksLikeBubble = f.filled >= 0.35 * cw * ch && holeRatio >= 0.02 && holeRatio <= 0.5 &&
        f.nHoles >= 3 && f.maxHole <= 0.3 * f.filled;
      best.bubble = looksLikeBubble
        ? { x0: best.x0, y0: best.y0, x1: best.x1, y1: best.y1, mask: f.mask, bw: cw, bh: ch, fill: best.pts.length / (cw * ch) }
        : null;
    }
    return best.bubble;
  }

  // Push each side outwards while the strip just beyond it still contains dark pixels,
  // up to 25% of the box size per side (enough to catch clipped characters, not the artwork around).
  function growToInk(white, W, H, box, k) {
    const b = { ...box };
    const step = Math.max(2, Math.round(2 * k));
    const maxX = 0.25 * (box.x1 - box.x0), maxY = 0.25 * (box.y1 - box.y0);
    const inkyRow = (y, xa, xb) => { let n = 0; for (let x = xa; x <= xb; x++) n += 1 - white[y * W + x]; return n > 0.01 * (xb - xa + 1); };
    const inkyCol = (x, ya, yb) => { let n = 0; for (let y = ya; y <= yb; y++) n += 1 - white[y * W + x]; return n > 0.01 * (yb - ya + 1); };
    const stripRows = (ya, yb) => { for (let y = Math.max(0, ya); y <= Math.min(H - 1, yb); y++) if (inkyRow(y, b.x0, b.x1)) return true; return false; };
    const stripCols = (xa, xb) => { for (let x = Math.max(0, xa); x <= Math.min(W - 1, xb); x++) if (inkyCol(x, b.y0, b.y1)) return true; return false; };
    for (let changed = true, guard = 0; changed && guard < 200; guard++) {
      changed = false;
      if (box.y0 - b.y0 < maxY && b.y0 > step && stripRows(b.y0 - step, b.y0 - 1)) { b.y0 -= step; changed = true; }
      if (b.y1 - box.y1 < maxY && b.y1 < H - 1 - step && stripRows(b.y1 + 1, b.y1 + step)) { b.y1 += step; changed = true; }
      if (box.x0 - b.x0 < maxX && b.x0 > step && stripCols(b.x0 - step, b.x0 - 1)) { b.x0 -= step; changed = true; }
      if (b.x1 - box.x1 < maxX && b.x1 < W - 1 - step && stripCols(b.x1 + 1, b.x1 + step)) { b.x1 += step; changed = true; }
    }
    return b;
  }

  function roundRect(ctx, x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  // Draws the numbered outlines the model sees (on a crop of page R scaled by s).
  function markBubbles(ctx, bubbles, R, s) {
    const fs = Math.max(13, Math.round(15 * s * (R.w / 500)));
    ctx.lineWidth = Math.max(2, fs / 7);
    ctx.font = `bold ${fs}px Arial,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    bubbles.forEach((b, i) => {
      const x0 = (b.x0 - R.x) * s, y0 = (b.y0 - R.y) * s, x1 = (b.x1 - R.x) * s, y1 = (b.y1 - R.y) * s;
      ctx.strokeStyle = '#e00';
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      // Number in the middle of its outline: a corner label sits ambiguously between neighbours.
      // (It covers some text in this copy only; the model reads the text from the clean image.)
      const label = String(i + 1), lw = ctx.measureText(label).width + fs * 0.5, lh = fs * 1.2;
      const lx = (x0 + x1) / 2, ly = (y0 + y1) / 2;
      ctx.fillStyle = '#e00';
      ctx.fillRect(lx - lw / 2, ly - lh / 2, lw, lh);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, lx, ly + 1);
    });
  }

  // shot: canvas with the screenshot.
  // regions: [{rect:{x,y,w,h} shot px, bubbles (from detect), items:[{bubble, box:[x0,y0,x1,y1] 0-1000, tr}]}]
  // Returns a transparent canvas the size of the screenshot.
  function render(shot, regions, { k = 1 } = {}) {
    const W = shot.width, H = shot.height;
    const data = shot.getContext('2d').getImageData(0, 0, W, H).data;
    const white = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) white[p] = lum(data, p * 4) >= THR ? 1 : 0;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    const MIN = 9 * k, MAX = 26 * k;
    const lab = new Int32Array(W * H), state = { id: 0, comps: new Map() };

    for (const reg of regions) {
      const R = reg.rect, bubbles = reg.bubbles || [];
      const toPx = (bx) => {
        const n = bx.map((v) => Math.max(0, Math.min(1000, Number(v)))); // keep it on this page
        const [a, b, c, d] = n;
        return { x0: R.x + Math.min(a, c) / 1000 * R.w, y0: R.y + Math.min(b, d) / 1000 * R.h,
          x1: R.x + Math.max(a, c) / 1000 * R.w, y1: R.y + Math.max(b, d) / 1000 * R.h };
      };
      const ov = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
      const area = (a) => (a.x1 - a.x0) * (a.y1 - a.y0);
      const centerIn = (a, q) => { const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2; return cx > q.x0 && cx < q.x1 && cy > q.y0 && cy < q.y1; };
      const byBubble = new Map(), loose = [], pending = [];
      const add = (b, tr) => { if (!byBubble.has(b)) byBubble.set(b, []); byBubble.get(b).push(tr); };

      // Pass 1: lines the model numbered, or whose box sits mostly inside a detected bubble.
      const parsed = (reg.items || []).map((it) => ({
        // Spaces matter between words, not between CJK characters.
        tr: String(it.tr || '').replace(/\s+/g, ' ').trim()
          .replace(new RegExp(`([${CJK}]) `, 'gu'), '$1').replace(new RegExp(` ([${CJK}])`, 'gu'), '$1'),
        box: Array.isArray(it.box) && it.box.length === 4 ? toPx(it.box) : null,
        b: bubbles[(Number(it.bubble) || 0) - 1] || null,
        src: String(it.src || '').trim(),
      })).filter((x) => x.tr && !(x.b === null && SFX.test(x.src)));
      // The model's numbers are usually right but sometimes off by a neighbour. Its rough box is the
      // second opinion. First keep the lines whose box agrees with their number, then fix the others.
      const agrees = (x) => x.b && x.box && area(x.box) > 0 && ov(x.b, x.box) >= 0.3 * area(x.box);
      const claimed = new Set(parsed.filter(agrees).map((x) => x.b));
      const center = (q) => [(q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2];
      const done = new Set();
      // a) Box lies on a different bubble nobody has: move there.
      for (const x of parsed) {
        if (!x.b || !x.box || agrees(x) || !(area(x.box) > 0)) continue;
        const own = ov(x.b, x.box);
        const alt = bubbles.filter((q) => q !== x.b && !claimed.has(q) && ov(q, x.box) > 0.3 * area(x.box) && ov(q, x.box) > 2 * own)
          .sort((p, q) => ov(q, x.box) - ov(p, x.box))[0];
        if (alt) { claimed.add(alt); x.b = alt; done.add(x); }
      }
      // b) Its number is taken by a line that does sit there: take the nearest free bubble instead.
      for (const x of parsed) {
        if (!x.b || !x.box || done.has(x) || agrees(x) || !claimed.has(x.b)) continue;
        const [cx, cy] = center(x.box);
        const reach = Math.max(Math.hypot(x.box.x1 - x.box.x0, x.box.y1 - x.box.y0), Math.hypot(x.b.bw, x.b.bh));
        const free = bubbles.filter((q) => !claimed.has(q))
          .map((q) => ({ q, d: Math.hypot(center(q)[0] - cx, center(q)[1] - cy) }))
          .filter((o) => o.d < reach).sort((a, b) => a.d - b.d)[0];
        if (free) { claimed.add(free.q); x.b = free.q; done.add(x); }
      }
      for (const x of parsed) {
        const { tr, box } = x;
        let b = x.b;
        if (b && box && area(box) > 0 && !done.has(x) && !agrees(x)) {
          claimed.add(b);
          const pad = { x0: b.x0 - 0.3 * b.bw, y0: b.y0 - 0.3 * b.bh, x1: b.x1 + 0.3 * b.bw, y1: b.y1 + 0.3 * b.bh };
          // Box nowhere near the numbered outline and no other bubble under it: likely the
          // number of a false detection next to an unoutlined bubble. Look at the box first.
          if (!ov(pad, box)) { pending.push({ tr, box, fallback: b }); continue; }
        }
        if (!b && box) b = bubbles.find((q) => area(box) > 0 && ov(q, box) > 0.6 * area(box));
        if (b) add(b, tr);
        else if (box) pending.push({ tr, box });
      }

      // Pass 2: the rest. The model's box is only a rough hint, so look for lettering near it.
      const blocks = (reg.blocks || []).map((b) => ({ ...b, used: [...byBubble.keys()].some((q) => centerIn(b, q)) }));
      const blockFor = (box) => {
        const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
        const ex = { x0: box.x0 - 0.5 * bw, y0: box.y0 - 0.5 * bh, x1: box.x1 + 0.5 * bw, y1: box.y1 + 0.5 * bh };
        const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
        const dist = (b) => Math.hypot((b.x0 + b.x1) / 2 - cx, (b.y0 + b.y1) / 2 - cy);
        const near = blocks.filter((b) => !b.used && ov(b, ex) > 0.5 * area(b));
        if (!near.length) return null;
        near.sort((a, b) => ov(b, box) - ov(a, box) || dist(a) - dist(b));
        // Start from the best block and absorb its close neighbours (one speech split into pieces).
        const u = { x0: near[0].x0, y0: near[0].y0, x1: near[0].x1, y1: near[0].y1 };
        const parts = new Set([near[0]]), gap = 10 * k;
        for (let grew = true; grew;) {
          grew = false;
          for (const b of near) {
            if (parts.has(b)) continue;
            const dx = Math.max(0, Math.max(u.x0, b.x0) - Math.min(u.x1, b.x1));
            const dy = Math.max(0, Math.max(u.y0, b.y0) - Math.min(u.y1, b.y1));
            if (dx > gap || dy > gap) continue;
            parts.add(b); grew = true;
            u.x0 = Math.min(u.x0, b.x0); u.y0 = Math.min(u.y0, b.y0); u.x1 = Math.max(u.x1, b.x1); u.y1 = Math.max(u.y1, b.y1);
          }
        }
        parts.forEach((b) => { b.used = true; });
        return u;
      };
      for (const { tr, box, fallback } of pending) {
        const u = blockFor(box);
        if (u) {
          const q = bubbles.find((q) => centerIn(u, q)); // the model missed the number
          // Lettering inside a bubble another line already owns means the model's box drifted;
          // then its number (if it gave one) is the better guess.
          if (q && (byBubble.has(q) || claimed.has(q)) && fallback) add(fallback, tr);
          else if (q) add(q, tr);
          else loose.push({ tr, text: u });
          continue;
        }
        const bx = { x0: Math.round(box.x0), y0: Math.round(box.y0), x1: Math.round(box.x1), y1: Math.round(box.y1) };
        // With a number from the model, trust it over a search around its (drifted) box.
        const b = fallback || (bx.x1 - bx.x0 >= 4 && bx.y1 - bx.y0 >= 4 ? bubbleAt(white, lab, W, H, bx, R, state) : null);
        if (b) add(b, tr); else loose.push({ tr, box });
      }

      const texts = []; // {tr, r}
      // 1) Whiten each used bubble (its inside plus the glyphs it encloses) and pick text areas.
      for (const [b, trs] of byBubble) {
        const img = new ImageData(b.bw, b.bh);
        for (let q = 0; q < b.bw * b.bh; q++) if (b.mask[q]) img.data.fill(255, q * 4, q * 4 + 4);
        const tc = document.createElement('canvas');
        tc.width = b.bw; tc.height = b.bh;
        tc.getContext('2d').putImageData(img, 0, 0);
        ctx.drawImage(tc, b.x0, b.y0);
        const s = b.fill > 0.8 ? 0.88 : 0.76; // rectangular caption vs round bubble
        const r = { x: b.x0 + b.bw * (1 - s) / 2, y: b.y0 + b.bh * (1 - s) / 2, w: b.bw * s, h: b.bh * s };
        // Several lines in one bubble: split along its long side (right-to-left when tall).
        const n = trs.length, tall = r.h > r.w;
        trs.forEach((tr, i) => texts.push({ tr, r: tall
          ? { x: r.x + r.w * (n - 1 - i) / n, y: r.y, w: r.w / n, h: r.h }
          : { x: r.x, y: r.y + r.h * i / n, w: r.w, h: r.h / n } }));
      }
      // 2) Lines outside any closed bubble: white label over the original lettering.
      //    `text` is lettering we found ourselves (exact); `box` is only the model's guess.
      for (const { tr, box, text } of loose) {
        let g;
        if (text) g = text;
        else {
          const bx = { x0: Math.round(box.x0), y0: Math.round(box.y0), x1: Math.round(box.x1), y1: Math.round(box.y1) };
          if (bx.x1 - bx.x0 < 4 || bx.y1 - bx.y0 < 4) continue;
          g = growToInk(white, W, H, bx, k);
        }
        const gw = g.x1 - g.x0, gh = g.y1 - g.y0;
        const pad = (text ? 0.15 : 0.08) * Math.min(gw, gh) + 3 * k;
        const lb = { x: g.x0 - pad, y: g.y0 - pad, w: gw + 2 * pad, h: gh + 2 * pad };
        // Stay on this page.
        const lx1 = Math.min(R.x + R.w, lb.x + lb.w), ly1 = Math.min(R.y + R.h, lb.y + lb.h);
        lb.x = Math.max(R.x, lb.x); lb.y = Math.max(R.y, lb.y); lb.w = lx1 - lb.x; lb.h = ly1 - lb.y;
        if (lb.w < 8 || lb.h < 8) continue;
        ctx.fillStyle = '#fff';
        roundRect(ctx, lb.x, lb.y, lb.w, lb.h, 6 * k);
        ctx.fill();
        texts.push({ tr, r: { x: lb.x + pad * 0.5, y: lb.y + pad * 0.5, w: lb.w - pad, h: lb.h - pad } });
      }
      // 3) One font size per page: nobody goes above the typical size, small bubbles shrink as needed.
      const plans = texts.map((t) => plan(ctx, t.tr, t.r, MIN, MAX));
      const sizes = plans.map((p) => p.size).sort((a, b) => a - b);
      const cap = sizes.length ? sizes[Math.floor(sizes.length / 2)] : MAX;
      texts.forEach((t, i) => {
        const p = plans[i].size > cap ? plan(ctx, t.tr, t.r, MIN, cap) : plans[i];
        drawText(ctx, t.tr, t.r, p.size, p.vertical);
      });
    }
    return out;
  }

  root.MangaLens = { detect, textBlocks, markBubbles, render };
})();
