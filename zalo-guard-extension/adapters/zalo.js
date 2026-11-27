// adapters/zalo.js - Zalo Web (chat.zalo.me), gồm cả mục "Tin nhắn từ người lạ".
// Mục người lạ hiển thị tin trong cùng khung hội thoại nên dùng chung selector tin nhắn.
// Zalo hay đổi tên class: nếu không bắt được tin, chỉnh TEXT_SEL / OWN_SEL bên dưới.
(() => {
  'use strict';
  const G = globalThis.GuardScanner;
  if (!G) return;

  const TEXT_SEL = [
    '.text-message__container',
    '[data-component="message-text-content"]',
    '.message-view .text',
    '.chat-message .text',
  ].join(',');
  const OWN_SEL = '.me, .is-me, .message-frame.me, [class*="message-me"], [class*="--me"], [class*="own"]';
  const PANE_SEL = '#messageViewScroll, #messageViewContainer, [class*="message-view"]';

  function convKey() {
    const title = document.querySelector('#header .header-title, #header [class*="title"], .header-title');
    return (title && title.textContent.trim().slice(0, 80)) || location.hash || location.pathname;
  }

  G.start({
    platform: 'zalo',
    isActive: () => location.hostname === 'chat.zalo.me',
    getMessages() {
      const conv = convKey();
      const out = [];
      document.querySelectorAll(TEXT_SEL).forEach((el) => {
        const own = el.closest(OWN_SEL) || G.isRightAligned(el, el.closest(PANE_SEL) || undefined);
        out.push({ el, incoming: !own, conv });
      });
      return out;
    },
  });
})();
