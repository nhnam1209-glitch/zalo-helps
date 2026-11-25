(() => {
  // Zalo Web đổi class thường xuyên: nếu không bắt được tin, sửa các selector dưới đây.
  const TEXT_SELECTORS = [
    '.text-message__container',
    '[data-component="message-text-content"]',
    '.message-view .text',
    '.chat-message .text',
  ].join(',');
  const OWN_ANCESTOR = '.me, .is-me, .message-frame.me, [class*="message-me"], [class*="--me"], [class*="own"]';

  const seen = new WeakSet();
  const HISTORY_BATCH = 3;     // >3 tin xuất hiện cùng lúc => coi là tải lịch sử
  const STARTUP_GRACE_MS = 3000;
  let graceUntil = Date.now() + STARTUP_GRACE_MS;
  let timer = null;

  const markAll = () => document.querySelectorAll(TEXT_SELECTORS).forEach((el) => seen.add(el));
  markAll();

  // Đổi cuộc trò chuyện => Zalo render lại lịch sử, cho thêm thời gian chờ.
  const extendGrace = () => { graceUntil = Date.now() + STARTUP_GRACE_MS; };
  window.addEventListener('hashchange', extendGrace);
  window.addEventListener('popstate', extendGrace);
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('[id^="conv-item"], .conv-item, [class*="conv-item"]')) extendGrace();
  }, true);

  function isOwn(el) {
    if (el.closest(OWN_ANCESTOR)) return true;
    // Dự phòng: tin của mình nằm lệch bên phải khung chat.
    const bubble = el.getBoundingClientRect();
    const pane = (el.closest('#messageViewScroll, [class*="message-view"], [class*="chat-content"]') || document.body).getBoundingClientRect();
    return pane.width > 0 && (bubble.left + bubble.right) / 2 > pane.left + pane.width * 0.6;
  }

  function collect(nodes) {
    const found = [];
    for (const n of nodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches?.(TEXT_SELECTORS)) found.push(n);
      n.querySelectorAll?.(TEXT_SELECTORS).forEach((el) => found.push(el));
    }
    return found.filter((el) => !seen.has(el));
  }

  const pending = [];
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      const fresh = collect(m.addedNodes);
      fresh.forEach((el) => pending.push(el));
    }
    if (pending.length && !timer) timer = setTimeout(flush, 300);
  });

  function flush() {
    timer = null;
    const batch = pending.splice(0).filter((el) => !seen.has(el));
    batch.forEach((el) => seen.add(el));
    if (Date.now() < graceUntil || batch.length > HISTORY_BATCH) return; // tin cũ
    for (const el of batch) {
      if (!el.isConnected || isOwn(el)) continue;
      send(el);
    }
  }

  function send(el) {
    let text = (el.innerText || '').trim();
    if (text.length < 2) return;
    chrome.runtime.sendMessage({ type: 'ANALYZE', text }, (resp) => {
      text = ''; // xóa biến chứa tin nhắn ngay khi nhận kết quả
      if (chrome.runtime.lastError || !resp?.ok) return;
      showAlert(resp.result);
    });
  }

  // ---- Khung cảnh báo (Shadow DOM, chỉ dùng textContent để tránh chèn HTML) ----
  let host = null;
  function showAlert(r) {
    host?.remove();
    host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    const level = r.risk_score >= 70 ? '#d32f2f' : r.risk_score >= 40 ? '#f57c00' : '#388e3c';

    const style = document.createElement('style');
    style.textContent = `
      .box{position:fixed;top:16px;right:16px;width:340px;max-height:80vh;overflow:auto;z-index:2147483647;
        background:#fff;border-left:6px solid ${level};border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.35);
        font:14px/1.4 system-ui,sans-serif;color:#222;padding:12px 14px}
      .h{display:flex;justify-content:space-between;align-items:center;font-weight:700}
      .score{color:${level};font-size:22px}
      button{border:0;background:none;font-size:18px;cursor:pointer}
      h4{margin:10px 0 4px;font-size:12px;text-transform:uppercase;color:#666}
      ul{margin:0;padding-left:18px} mark{background:#ffe08a}
      .tag{display:inline-block;background:#eee;border-radius:10px;padding:2px 8px;margin:2px 4px 2px 0}`;

    const box = document.createElement('div');
    box.className = 'box';
    const head = document.createElement('div');
    head.className = 'h';
    const title = document.createElement('span');
    title.textContent = 'Zalo Guard · Điểm rủi ro: ';
    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = `${r.risk_score}/100`;
    title.appendChild(score);
    const close = document.createElement('button');
    close.textContent = '✕';
    close.onclick = () => host.remove();
    head.append(title, close);
    box.appendChild(head);

    const section = (label, content) => {
      const h = document.createElement('h4');
      h.textContent = label;
      box.append(h, content);
    };
    const tacticsEl = document.createElement('div');
    if (r.tactics.length) r.tactics.forEach((t) => { const s = document.createElement('span'); s.className = 'tag'; s.textContent = t; tacticsEl.appendChild(s); });
    else tacticsEl.textContent = 'Không phát hiện chiêu thức.';
    section('Chiêu thức', tacticsEl);

    const tr = document.createElement('div');
    tr.textContent = r.translation || '—';
    section('Giải mã ý đồ', tr);

    if (r.highlights.length) {
      const ul = document.createElement('ul');
      r.highlights.forEach((h) => { const li = document.createElement('li'); const m = document.createElement('mark'); m.textContent = h; li.appendChild(m); ul.appendChild(li); });
      section('Cụm từ đáng ngờ', ul);
    }

    root.append(style, box);
    document.documentElement.appendChild(host);
  }

  observer.observe(document.body, { childList: true, subtree: true });
})();
