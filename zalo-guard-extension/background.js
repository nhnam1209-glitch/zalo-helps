// Gọi API từ service worker để tránh vướng CORS/mixed content của trang chat.
// Zero-Retention: nội dung tin nhắn chỉ nằm trong biến cục bộ và được gán null ngay khi xong.
const API_URL = 'https://zalo-helps.vercel.app/api/analyze-text';
const PLATFORMS = new Set(['zalo', 'messenger', 'instagram']);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'ANALYZE' || sender.id !== chrome.runtime.id) return;
  (async () => {
    let payload = null;
    try {
      if (typeof msg.text !== 'string' || !PLATFORMS.has(msg.platform)) throw new Error('bad_request');
      payload = JSON.stringify({ text: msg.text, platform: msg.platform });
      msg = null;
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      sendResponse({ ok: true, result: await res.json() });
    } catch (e) {
      sendResponse({ ok: false, error: String(e.message || e) });
    } finally {
      payload = null;
      msg = null;
    }
  })();
  return true; // giữ kênh phản hồi bất đồng bộ
});
