"""Make the Chrome Web Store images and the upload zip.

    python store/make_assets.py            # images for en + zh, and dist/bubble-translate-<version>.zip
    python store/make_assets.py --no-options   # skip the settings-page capture (needs Playwright + Chromium)

Writes store/out/<lang>/shot_1..5.png (1280x800), tile_440x280.png, marquee_1400x560.png.
Sources: demo/ pages (made by the extension itself), store/src_numbering.png (a still from the promo
video's numbering animation), and a capture of the real options page with a fake key.
"""
import argparse
import json
import shutil
import tempfile
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
DEMO = ROOT / "demo"
OUT = Path(__file__).resolve().parent / "out"
FONTS = Path("C:/Windows/Fonts")
BG, BG2, FG, DIM, ACC = (16, 18, 24), (28, 32, 42), (240, 242, 246), (150, 158, 172), (255, 196, 64)

TEXT = {
    "en": {
        "font": "segoeuib.ttf", "font2": "segoeui.ttf",
        "shots": [
            ("One key. The whole page.", "Press Alt+Shift+J on any manga page.", "page_1.jpg", "page_1_en.jpg"),
            ("Right inside the original bubbles", "Original text wiped, translation lettered in, vertical or horizontal.", "action_1.jpg", "action_1_en.jpg"),
            ("Any language you read", "English, Chinese, Korean, Spanish, whatever the model knows.", "page_2.jpg", "page_2_zh.jpg"),
            ("It numbers every bubble first", "So the AI only says which line goes where.", "numbering", None),
            ("Your own key. No server of ours.", "DeepSeek or Gemini. About 4 s and under a cent for two pages.", "options", None),
        ],
        "before": "Before", "after": "After",
        "name": "Bubble Translate", "tag": "Manga translator for any page",
    },
    "zh": {
        "font": "msyhbd.ttc", "font2": "msyh.ttc",
        "shots": [
            ("一个键，整页翻好", "在任意漫画页按 Alt+Shift+J。", "page_1.jpg", "page_1_zh.jpg"),
            ("译文排回原来的对话框", "抹掉原文、排进译文，横排竖排都行。", "action_1.jpg", "action_1_zh.jpg"),
            ("你看哪种语言都行", "中文、英文、韩文、西班牙文，模型懂的都行。", "page_2.jpg", "page_2_en.jpg"),
            ("先给每个对话框编号", "AI 只需要说哪句放进几号框。", "numbering", None),
            ("用你自己的 key，没有我们的服务器", "DeepSeek 或 Gemini，两页约 4 秒、不到一分钱。", "options", None),
        ],
        "before": "原文", "after": "译文",
        "name": "气泡翻译", "tag": "任意网页的漫画翻译",
    },
}


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def fit(img, w, h):
    im = img.copy()
    im.thumbnail((w, h), Image.LANCZOS)
    return im


def top_part(img, h):
    """The page down to the panel gutter nearest two thirds of its height, scaled to height h."""
    import numpy as np
    g = np.asarray(img.convert("L"), dtype=np.int16)
    lo, hi = round(img.height * 0.5), round(img.height * 0.72)
    white = [y for y in range(lo, hi) if (g[y] > 235).mean() > 0.9]   # a gutter row: nearly all white
    if white:
        cut = min(white, key=lambda y: abs(y - img.height * 0.64))
    else:   # slanted panels: no row is all gutter, so take the whitest row
        cut = lo + int(np.argmax([(g[y] > 235).mean() for y in range(lo, hi)]))
    im = img.crop((0, 0, img.width, cut))
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)


def card(canvas, im, x, y, label=None, f=None):
    """Paste with a soft shadow and a small corner label."""
    sh = Image.new("RGBA", (im.width + 40, im.height + 40), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle((20, 24, 20 + im.width, 24 + im.height), fill=(0, 0, 0, 150))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(12)), (x - 20, y - 20))
    canvas.paste(im, (x, y))
    if label:
        d = ImageDraw.Draw(canvas)
        tw = d.textlength(label, font=f)
        d.rounded_rectangle((x + 10, y + 10, x + 26 + tw, y + 14 + f.size + 12), 8, fill=(16, 18, 24, 220))
        d.text((x + 18, y + 14), label, font=f, fill=FG)


def wrap(d, text, f, width):
    """Wrap at spaces (Latin) or anywhere (CJK)."""
    lines, cur = [], ""
    tokens = text.split(" ") if " " in text and not any("一" <= c <= "鿿" for c in text) else list(text)
    sep = " " if len(tokens) > 1 and tokens != list(text) else ""
    for t in tokens:
        nxt = (cur + sep + t) if cur else t
        if d.textlength(nxt, font=f) > width and cur:
            lines.append(cur)
            cur = t
        else:
            cur = nxt
    return lines + [cur]


def caption(canvas, title, sub, L, x, y, width):
    d = ImageDraw.Draw(canvas)
    ft, fs = font(L["font"], 52), font(L["font2"], 26)
    d.rectangle((x, y, x + 56, y + 6), fill=ACC)
    y += 30
    for ln in wrap(d, title, ft, width):
        d.text((x, y), ln, font=ft, fill=FG)
        y += 66
    y += 14
    for ln in wrap(d, sub, fs, width):
        d.text((x, y), ln, font=fs, fill=DIM)
        y += 38


def background(w, h):
    bg = Image.new("RGBA", (w, h), BG + (255,))
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((w * 0.45, -h * 0.4, w * 1.3, h * 1.1), fill=BG2 + (255,))
    bg.alpha_composite(glow.filter(ImageFilter.GaussianBlur(120)))
    return bg


def shot(lang, i, spec, options_png):
    L = TEXT[lang]
    title, sub, a, b = spec
    W, H = 1280, 800
    c = background(W, H)
    fl = font(L["font"], 20)
    if b:   # caption band on top, the top two thirds of before / after below, big enough to read
        d = ImageDraw.Draw(c)
        ft, fs = font(L["font"], 46), font(L["font2"], 24)
        d.rectangle((64, 44, 120, 50), fill=ACC)
        d.text((64, 62), title, font=ft, fill=FG)
        sx = 64 + d.textlength(title, font=ft) + 28
        if sx + d.textlength(sub, font=fs) <= W - 64:   # subtitle beside the title, or under it
            d.text((sx, 62 + ft.size - fs.size - 4), sub, font=fs, fill=DIM)
            top, h = 150, 590
        else:
            d.text((64, 62 + ft.size + 14), sub, font=fs, fill=DIM)
            top, h = 180, 570
        gap = 56
        A, B = (top_part(Image.open(DEMO / n).convert("RGB"), h) for n in (a, b))
        if A.width + B.width + gap > W - 80:   # wide crops: shrink so the pair fits with 40 px margins
            h = int(h * (W - 80 - gap) / (A.width + B.width))
            A, B = (top_part(Image.open(DEMO / n).convert("RGB"), h) for n in (a, b))
        x1 = (W - A.width - B.width - gap) // 2
        y = top + (H - top - h) // 2 - 8
        card(c, A, x1, y, L["before"], fl)
        card(c, B, x1 + A.width + gap, y, L["after"], fl)
        ax, ay = x1 + A.width + gap // 2, y + h // 2   # arrow between the two
        d.polygon([(ax - 10, ay - 16), (ax + 12, ay), (ax - 10, ay + 16)], fill=ACC)
    elif a == "numbering":
        src = Image.open(Path(__file__).parent / "src_numbering.png").convert("RGB").crop((55, 233, 1025, 1687))
        im = fit(src, 520, 720)
        card(c, im, W - 70 - im.width, (H - im.height) // 2)
        caption(c, title, sub, L, 64, 260, W - 70 - im.width - 64 - 60)
    else:   # options page
        im = fit(Image.open(options_png).convert("RGB"), 640, 720)
        card(c, im, W - 60 - im.width, (H - im.height) // 2)
        caption(c, title, sub, L, 64, 250, W - 60 - im.width - 64 - 56)
    out = OUT / lang / f"shot_{i}.png"
    c.convert("RGB").save(out)
    return out


def split_page(lang, h, w):
    """The same page, Japanese on the left and translated on the right, cut along a diagonal."""
    a = Image.open(DEMO / "page_1.jpg").convert("RGB")
    b = Image.open(DEMO / ("page_1_zh.jpg" if lang == "zh" else "page_1_en.jpg")).convert("RGB")
    # top-right panel area holds the bubbles that read best small: crop a w:h window from the top
    cw = a.width
    ch = round(cw * h / w)
    a, b = (im.crop((0, 0, cw, min(ch, im.height))).resize((w, h), Image.LANCZOS) for im in (a, b))
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).polygon([(w * 0.62, 0), (w, 0), (w, h), (w * 0.38, h)], fill=255)
    a.paste(b, (0, 0), m)
    d = ImageDraw.Draw(a)
    d.line([(w * 0.62, 0), (w * 0.38, h)], fill=ACC, width=max(3, w // 150))
    return a


def banner(lang, W, H, out):
    """Icon and name on the left, a split before/after page on the right."""
    L = TEXT[lang]
    c = background(W, H)
    s = H / 280
    pw = round(W * (0.56 if W / H < 2 else 0.5))
    pg = split_page(lang, H, pw)
    c.paste(pg, (W - pw, 0))
    fade = Image.new("RGBA", (round(40 * s), H))   # soften the page's left edge into the background
    for x in range(fade.width):
        ImageDraw.Draw(fade).line([(x, 0), (x, H)], fill=BG + (round(255 * (1 - x / fade.width)),))
    c.alpha_composite(fade, (W - pw, 0))
    d = ImageDraw.Draw(c)
    x = round(22 * s)
    width = W - pw - x - round(10 * s)
    icon = Image.open(EXT / "icons" / "128.png").convert("RGBA").resize((round(64 * s),) * 2, Image.LANCZOS)
    c.alpha_composite(icon, (x, round(34 * s)))
    fn = font(L["font"], round(40 * s))
    words = L["name"].split(" ") if " " in L["name"] else [L["name"]]
    while max(d.textlength(w_, font=fn) for w_ in words) > width:
        fn = font(L["font"], fn.size - 1)
    y = round(112 * s)
    for w_ in words:
        d.text((x, y), w_, font=fn, fill=FG)
        y += round(fn.size * 1.12)
    ft = font(L["font2"], round(18 * s))
    y += round(6 * s)
    for ln in wrap(d, L["tag"], ft, width):
        d.text((x, y), ln, font=ft, fill=DIM)
        y += round(ft.size * 1.3)
    c.convert("RGB").save(out)


def capture_options(lang, out):
    """The real options page in a headless Chromium with the extension loaded, filled with a fake key."""
    from playwright.sync_api import sync_playwright
    tmp = Path(tempfile.mkdtemp())
    try:
        ext = tmp / "ext"
        shutil.copytree(EXT, ext)
        with sync_playwright() as pw:
            ctx = pw.chromium.launch_persistent_context(
                str(tmp / "profile"), channel="chromium", headless=True, device_scale_factor=2,
                viewport={"width": 680, "height": 760}, color_scheme="light",
                args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}",
                      f"--lang={'zh-CN' if lang == 'zh' else 'en-US'}"])
            sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
            ext_id = sw.url.split("/")[2]
            p = ctx.new_page()
            p.goto(f"chrome-extension://{ext_id}/options.html")
            p.wait_for_selector("#dsKey")
            p.select_option("#provider", "deepseek")
            p.fill("#target", "Chinese (Simplified)" if lang == "zh" else "English")
            p.fill("#dsKey", "sk-demo-not-a-real-key-0000000000")   # shown masked; fake on purpose
            p.dispatch_event("#provider", "change")
            p.evaluate("document.querySelector('main').style.margin='16px auto'")
            p.locator("main").screenshot(path=str(out))
            ctx.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def build_zip():
    ver = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))["version"]
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    z = dist / f"bubble-translate-{ver}.zip"
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(EXT.rglob("*")):
            if f.is_file():
                zf.write(f, f.relative_to(EXT).as_posix())   # manifest.json at the zip root
    return z


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-options", action="store_true")
    a = ap.parse_args()
    for lang in TEXT:
        (OUT / lang).mkdir(parents=True, exist_ok=True)
        opt = OUT / lang / "_options_page.png"
        if not a.no_options or not opt.exists():
            capture_options(lang, opt)
        for i, spec in enumerate(TEXT[lang]["shots"], 1):
            print("wrote", shot(lang, i, spec, opt).relative_to(ROOT))
        banner(lang, 440, 280, OUT / lang / "tile_440x280.png")
        banner(lang, 1400, 560, OUT / lang / "marquee_1400x560.png")
        print("wrote tile + marquee", lang)
    print("wrote", build_zip().relative_to(ROOT))


if __name__ == "__main__":
    main()
