// adapters/messenger.js - messenger.com, facebook.com/messages và các ô chat nhỏ nổi ở góc facebook.com.
// Chỉ quét bên trong vùng hội thoại (grid "Tin nhắn trong cuộc trò chuyện" hoặc khung có ô soạn tin),
// nên không quét News Feed, bài viết, bình luận hay danh sách bên trái.
// Facebook dùng class bị mã hóa: adapter chỉ dựa vào role/aria-label. Nếu giao diện đổi, chỉnh các hằng số dưới.
(() => {
  'use strict';
  const G = globalThis.GuardScanner;
  if (!G) return;

  const CONV_LABEL = /(messages in conversation|tin nhắn trong cuộc trò chuyện)/i;
  const COMPOSER_LABEL = /^(tin nhắn|message|nhắn tin|aa)\b/i;
  const EXCLUDE = '[role="article"],[role="feed"],[role="navigation"],[role="banner"],[role="search"]';
  const SKIP_TEXT = '[role="button"],[role="heading"],[role="textbox"],h1,h2,h3,h4,time';

  function findScopes() {
    const scopes = [];
    const add = (c) => {
      if (!c || c.closest(EXCLUDE)) return;
      if (scopes.some((s) => s === c || s.contains(c) || c.contains(s))) return;
      scopes.push(c);
    };
    // 1) Khung tin nhắn có aria-label đặc trưng (trang lớn lẫn ô chat nhỏ).
    document.querySelectorAll('[role="grid"][aria-label]').forEach((g) => {
      if (CONV_LABEL.test(g.getAttribute('aria-label'))) add(g);
    });
    // 2) Dự phòng cho ô chat nhỏ: từ ô soạn tin đi lên tới khung đầu tiên có chứa các dòng tin nhắn.
    document.querySelectorAll('[role="textbox"][contenteditable="true"]').forEach((tb) => {
      if (tb.closest(EXCLUDE) || !COMPOSER_LABEL.test(tb.getAttribute('aria-label') || '')) return;
      let p = tb.parentElement;
      for (let i = 0; p && i < 12; i++, p = p.parentElement) {
        if (p.querySelector('[role="row"]')) { add(p); break; }
      }
    });
    return scopes;
  }

  G.start({
    platform: 'messenger',
    isActive: () => {
      const h = location.hostname;
      return h === 'www.messenger.com' || h === 'www.facebook.com';
    },
    getMessages() {
      const out = [];
      for (const scope of findScopes()) {
        const conv = scope.getAttribute('aria-label') || location.pathname;
        scope.querySelectorAll('[dir="auto"]').forEach((el) => {
          if (el.querySelector('[dir="auto"]') || el.closest(SKIP_TEXT)) return; // chỉ lấy phần tử lá chứa chữ
          out.push({ el, incoming: !G.isRightAligned(el, scope), conv });
        });
      }
      return out;
    },
  });
})();
