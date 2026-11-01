# Chrome Web Store listing

Everything to paste into the Developer Dashboard. Images are in `store/out/` (made by `python store/make_assets.py`), the upload zip in `dist/`.

Privacy policy URL (needs the GitHub repo published first):
`https://github.com/Huuuuung/bubble-translate/blob/main/PRIVACY.md`

Homepage / support URL: `https://github.com/Huuuuung/bubble-translate`

---

## Store listing tab

**Name** (from the manifest, can't be edited here): Bubble Translate – Manga Translator · 气泡翻译 – 网页漫画翻译

**Summary** (from the manifest `description`, ≤132 characters): already set by `_locales/*/messages.json` → `extDesc`.

**Category:** Tools  (alternative: Productivity)

**Language:** English (default), plus Chinese (Simplified) — the dashboard picks up both from `_locales`.

### Description (English)

```
Read raw manga in your own language, right on the page.

Press Alt+Shift+J (or click the icon) on any manga page. Bubble Translate finds the speech bubbles, wipes the original text and letters the translation back into the same bubbles — horizontal or vertical, sized to fit. Press again to restore the original.

HOW IT WORKS
• It finds and numbers every bubble on the page first, so the AI only has to say which line goes where. Text lands in the right bubble instead of floating over the art.
• Works on almost any site and reader: it translates what's on your screen, not a particular site's images.
• Translate into English, Chinese, Korean, Spanish or any language the model knows.

BRING YOUR OWN KEY
• Uses your own DeepSeek or Gemini API key. No subscription, no account with us.
• Two pages take about four seconds and cost less than a cent with DeepSeek.

PRIVACY
• There is no server of ours. Screenshots of the page go straight from your browser to the AI provider you picked, and nowhere else.
• Your key is stored only in your browser (chrome.storage.local).
• No analytics, no tracking, no remote code.

Free and open source (MIT): https://github.com/Huuuuung/bubble-translate
```

### Description (简体中文)

```
在网页上直接用你的语言看生肉漫画。

在任意漫画页按 Alt+Shift+J（或点插件图标），气泡翻译会找出对话框、抹掉原文，把译文排回原来的气泡里——横排竖排都行，字号自动适配。再按一次恢复原文。

原理
• 先找出页面上每个对话框并编号，AI 只需要说哪句放进几号框，译文不会飘到画面上。
• 几乎所有网站和阅读器都能用：它翻译的是你屏幕上看到的内容，不依赖某个网站的图片。
• 可以译成中文、英文、韩文、西班牙文，或模型懂的任何语言。

用你自己的 key
• 用你自己的 DeepSeek 或 Gemini API key，不用订阅，也不用注册我们的账号。
• 两页大约 4 秒，用 DeepSeek 花费不到一分钱。

隐私
• 我们没有服务器。页面截图从你的浏览器直接发给你选的 AI 服务商，不经过别处。
• key 只存在你的浏览器里（chrome.storage.local）。
• 没有统计、没有追踪、没有远程代码。

免费开源（MIT）：https://github.com/Huuuuung/bubble-translate
```

### Graphics

| Field | File |
|---|---|
| Store icon 128×128 | `extension/icons/128.png` |
| Screenshots 1280×800 (up to 5) | `store/out/en/shot_1…5.png` (English listing), `store/out/zh/shot_1…5.png` (Chinese listing) |
| Small promo tile 440×280 | `store/out/en/tile_440x280.png` / `store/out/zh/tile_440x280.png` |
| Marquee 1400×560 (optional) | `store/out/en/marquee_1400x560.png` / `store/out/zh/…` |

---

## Privacy practices tab

**Single purpose:**
```
Translate the text in manga and comic speech bubbles on the page the user is viewing, and draw the translation over the original bubbles.
```

**Permission justifications:**

| Permission | Justification (paste) |
|---|---|
| `activeTab` | Only when the user presses the shortcut or clicks the icon, the extension captures the visible tab (captureVisibleTab) to find speech bubbles and read their text. No access to tabs the user didn't act on. |
| `scripting` | Injects the content script into the active tab after the user's click/shortcut, to draw the translated text over the bubbles and to remove it again when the user presses the shortcut a second time. |
| `storage` | Saves the user's settings in chrome.storage.local: chosen AI provider, model, target language and the user's own API key. Nothing is synced or sent to us. |
| Host `https://api.deepseek.com/*` | Sends the cropped page screenshot and prompt to DeepSeek's API with the user's own key, when the user picked DeepSeek. This is the translation request itself. |
| Host `https://generativelanguage.googleapis.com/*` | Same as above for Google Gemini, when the user picked Gemini. |

**Remote code:** No, I am not using remote code. (All JavaScript ships in the package; the extension only sends data to the AI APIs and reads back JSON.)

**Data usage — what to tick:**
- ☑ **Website content** — screenshots of the visible page are sent to the AI provider the user chose, to translate them.
- ☑ **Authentication information** — the user's own API key is stored locally and sent only to that provider as the API credential.
- Everything else (personally identifiable info, health, financial, location, web history, user activity, personal communications): not collected.

**Certify (all three):**
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases (sending it to the user-chosen AI provider is the feature itself).
- ☑ I do not use or transfer user data for purposes unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** see top of this file.

---

## Distribution tab
- Visibility: Public
- Regions: All regions
- Pricing: free (the dashboard no longer has paid items)

## Test instructions for the reviewer (optional field)
```
The extension needs an API key to translate. Open the extension's Options page, choose DeepSeek or Gemini and paste a key (a free Gemini key works: https://aistudio.google.com/apikey). Then open any manga page with Japanese text, e.g. a raw chapter on a manga reader, and press Alt+Shift+J or click the toolbar icon. Press again to restore.
```
