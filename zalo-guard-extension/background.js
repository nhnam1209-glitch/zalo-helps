// Gọi API từ service worker để tránh vướng CORS/mixed content của trang Zalo.
const API_URL = 'http://localhost:3000/api/analyze-text';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'ANALYZE') return;
  (async () => {
    let payload = JSON.stringify({ text: msg.text });
    msg = null;
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      sendResponse({ ok: true, result: await res.json() });
    } catch (e) {
      sendResponse({ ok: false, error: String(e.message || e) });
    } finally {
      payload = null;
    }
  })();
  return true; // giữ kênh phản hồi bất đồng bộ
});
