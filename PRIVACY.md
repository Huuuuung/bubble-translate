# Privacy

Bubble Translate has no server and collects nothing.

- **Your API key** is saved with `chrome.storage.local`, only in your browser. It is sent only to the provider you picked (DeepSeek or Google Gemini).
- **Screenshots**: when you press the shortcut or click the icon, the extension takes a screenshot of the visible tab, crops the manga pages and sends those crops straight from your browser to that provider. Nothing is sent anywhere else, and nothing is saved.
- **No tracking**: no analytics, no telemetry, no remote code.
- The provider's own privacy policy covers what happens to the images you send it.

Permissions: `activeTab` (screenshot the tab you are on, only when you trigger it), `scripting` (draw the translation on that page), `storage` (keep your settings).
