// adapters/instagram.js - chỉ hoạt động ở khu vực tin nhắn /direct/ (gồm hộp tin nhắn chờ / người lạ).
// Ngoài /direct/ (bảng tin, bình luận...) adapter báo isActive() = false nên scanner không quét gì.
// Nếu giao diện Instagram đổi, chỉnh SKIP_TEXT / selector bên dưới.
(() => {
  'use strict';
  const G = globalThis.GuardScanner;
  if (!G) return;

  // Bỏ qua danh sách hội thoại bên trái (các link /direct/t/...), nút, tiêu đề, ô soạn tin.
  const SKIP_TEXT = [
    'a[href*="/direct/"]', '[role="button"]', '[role="heading"]', '[role="textbox"]',
    '[role="navigation"]', '[role="listbox"]', '[role="tablist"]', 'h1', 'h2', 'h3', 'header', 'time',
  ].join(',');

  G.start({
    platform: 'instagram',
    isActive: () => location.hostname === 'www.instagram.com' && location.pathname.startsWith('/direct/'),
    getMessages() {
      const main = document.querySelector('[role="main"]');
      if (!main) return [];
      const conv = location.pathname;
      const out = [];
      main.querySelectorAll('[dir="auto"], span[dir="auto"]').forEach((el) => {
        if (el.querySelector('[dir="auto"]') || el.closest(SKIP_TEXT)) return;
        out.push({ el, incoming: !G.isRightAligned(el), conv });
      });
      return out;
    },
  });
})();
