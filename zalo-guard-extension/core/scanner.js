// core/scanner.js - lõi quét dùng chung cho mọi nền tảng.
// Adapter chỉ cần gọi: GuardScanner.start({ platform, isActive(), getMessages() })
//   getMessages() => [{ el, incoming, conv?, text? }]
//     el       : phần tử chứa văn bản tin nhắn (badge sẽ bám vào đây)
//     incoming : true nếu là tin của đối phương (tin của mình bị bỏ qua)
//     conv     : định danh hội thoại (dùng để chống gửi lặp)
// Zero-Retention: nội dung tin chỉ nằm trong biến cục bộ/job và được gán null ngay sau khi nhận kết quả.
// Bộ nhớ đệm chỉ lưu băm (hash) và kết quả chấm điểm, không lưu văn bản gốc.
(() => {
  'use strict';
  if (globalThis.GuardScanner) return;

  const CFG = {
    debounceMs: 280,    // gom các lần quét trong 280ms
    threshold: 40,      // risk_score >= ngưỡng này thì hiện badge
    minLen: 6,
    maxLen: 2000,
    maxPerScan: 25,     // tối đa số tin đang hiển thị được xét mỗi lần quét
    concurrency: 3,
    cacheMax: 500,
    retryAfterMs: 30000 // sau lỗi mạng/API, chờ rồi mới thử lại
  };

  // ---------- tiện ích ----------
  function hashStr(s) { // cyrb53
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  function textOf(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function scrollParent(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return p;
    }
    return null;
  }

  // Tin của mình nằm lệch phải: khoảng trống bên trái lớn hơn bên phải.
  function isRightAligned(el, scope) {
    const box = scope || scrollParent(el) || document.documentElement;
    const r = el.getBoundingClientRect();
    const s = box.getBoundingClientRect();
    if (!r.width || !s.width) return false;
    return r.left - s.left > s.right - r.right;
  }

  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---------- trạng thái ----------
  const elKey = new WeakMap();   // phần tử -> khóa (hash hội thoại + nội dung)
  const cache = new Map();       // khóa -> kết quả chấm điểm (không chứa văn bản gốc)
  const inflight = new Map();    // khóa -> job đang chờ API
  const failedAt = new Map();    // khóa -> thời điểm lỗi gần nhất
  const queue = [];
  let running = 0;

  function remember(key, v) {
    cache.set(key, v);
    if (cache.size > CFG.cacheMax) cache.delete(cache.keys().next().value);
  }

  function slim(r) {
    const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, 6) : []);
    return {
      risk_score: Math.max(0, Math.min(100, Math.round(Number(r.risk_score)) || 0)),
      tactics: strs(r.tactics),
      translation: typeof r.translation === 'string' ? r.translation.slice(0, 400) : '',
      highlights: strs(r.highlights),
    };
  }

  // ---------- gọi API qua background.js ----------
  function pump() {
    while (running < CFG.concurrency && queue.length) {
      const job = queue.shift();
      running++;
      run(job).then(() => { running--; pump(); });
    }
  }

  function run(job) {
    return new Promise((resolve) => {
      let text = job.text;
      job.text = null;
      const done = (resp) => {
        text = null; // xóa biến chứa tin nhắn ngay khi có kết quả
        try { settle(job, resp); } catch { /* fail-safe */ }
        resolve();
      };
      try {
        if (!chrome.runtime?.id) return done(null); // extension vừa được reload
        chrome.runtime.sendMessage({ type: 'ANALYZE', platform: state.adapter.platform, text }, (resp) => {
          void chrome.runtime.lastError;
          done(resp);
        });
      } catch {
        done(null);
      }
    });
  }

  function settle(job, resp) {
    inflight.delete(job.key);
    const ok = resp && resp.ok && resp.result && typeof resp.result === 'object';
    if (!ok) {
      failedAt.set(job.key, Date.now());
      for (const el of job.waiters) {
        if (elKey.get(el) === job.key) { delete el.dataset.guardChecked; elKey.delete(el); }
      }
      return;
    }
    const v = slim(resp.result);
    remember(job.key, v);
    for (const el of job.waiters) {
      if (el.isConnected && elKey.get(el) === job.key) applyVerdict(el, job.key, v);
    }
    job.waiters.clear();
  }

  // ---------- quét ----------
  const state = { adapter: null, timer: null, lastHref: location.href };

  function processItem(m) {
    const el = m.el;
    let text = typeof m.text === 'string' ? m.text : textOf(el);
    if (text.length < CFG.minLen) return;
    if (text.length > CFG.maxLen) text = text.slice(0, CFG.maxLen);
    const key = hashStr((m.conv || '') + '|' + text);

    if (el.dataset.guardChecked === '1' && elKey.get(el) === key) {
      const v = cache.get(key);
      if (v) applyVerdict(el, key, v); // giữ/khôi phục badge khi DOM render lại
      text = null;
      return;
    }
    if (elKey.has(el) && elKey.get(el) !== key) removeBadge(el); // nút DOM bị tái sử dụng cho tin khác

    const failed = failedAt.get(key);
    if (failed && Date.now() - failed < CFG.retryAfterMs) { text = null; return; }

    el.dataset.guardChecked = '1';
    elKey.set(el, key);

    const cached = cache.get(key);
    if (cached) { applyVerdict(el, key, cached); text = null; return; }

    const pending = inflight.get(key);
    if (pending) { pending.waiters.add(el); text = null; return; }

    const job = { key, text, waiters: new Set([el]) };
    inflight.set(key, job);
    queue.push(job);
    text = null;
    pump();
  }

  function scanVisibleMessages() {
    state.timer = null;
    try {
      const a = state.adapter;
      if (!a.isActive()) { clearBadges(); return; }
      let items = a.getMessages() || [];
      const vh = window.innerHeight;
      items = items.filter((m) => {
        if (!m || !m.el || !m.el.isConnected || m.incoming === false) return false;
        const r = m.el.getBoundingClientRect();
        return r.height > 0 && r.bottom > 0 && r.top < vh;
      });
      if (items.length > CFG.maxPerScan) items = items.slice(-CFG.maxPerScan);
      for (const m of items) {
        try { processItem(m); } catch { /* một tin lỗi không làm hỏng cả lượt quét */ }
      }
      items = null;
    } catch { /* fail-safe: không bao giờ ném lỗi ra trang chat */ }
    schedulePosition();
  }

  function schedule() {
    if (state.timer) return; // gom nhiều sự kiện thành một lần quét
    state.timer = setTimeout(scanVisibleMessages, CFG.debounceMs);
  }

  // ---------- overlay badge (không chèn vào DOM của trang chat nên không làm vỡ bố cục) ----------
  const CSS = `
    .pill{position:fixed;left:0;top:0;z-index:1;pointer-events:auto;border:0;margin:0;cursor:pointer;
      font:600 11px/16px system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;background:#ef6c00;
      padding:0 7px;border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,.35);white-space:nowrap}
    .pill.hi{background:#d32f2f}
    .pill[hidden],.pop[hidden]{display:none}
    .pop{position:fixed;z-index:2;pointer-events:auto;width:280px;max-width:calc(100vw - 16px);max-height:60vh;overflow:auto;
      box-sizing:border-box;background:#fff;color:#222;border-radius:10px;border-top:4px solid #ef6c00;
      box-shadow:0 6px 24px rgba(0,0,0,.35);padding:8px 12px 10px;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
    .pop.hi{border-top-color:#d32f2f}
    .hd{display:flex;justify-content:space-between;align-items:center;font-weight:700}
    .x{border:0;background:none;font-size:15px;cursor:pointer;color:#555;padding:0 2px}
    .lb{margin:8px 0 3px;font-size:11px;text-transform:uppercase;color:#777}
    .tag{display:inline-block;background:#eee;border-radius:10px;padding:1px 8px;margin:2px 4px 2px 0;font-size:12px}
    mark{background:#ffe08a;border-radius:3px;padding:0 2px}
    ul{margin:0;padding-left:18px}`;

  let host = null, layer = null, pop = null;
  const entries = new Map(); // el -> { node, key, result, scroller }
  let activeEl = null, pinned = false, closeTimer = null, posQueued = false;

  function ensureOverlay() {
    if (host && host.isConnected) return;
    entries.clear();
    host = document.createElement('div');
    host.setAttribute('data-zalo-guard', '1');
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    layer = h('div');
    pop = h('div', 'pop');
    pop.hidden = true;
    pop.addEventListener('mouseenter', () => clearTimeout(closeTimer));
    pop.addEventListener('mouseleave', leaveClose);
    root.append(style, layer, pop);
    document.documentElement.appendChild(host);
  }

  function applyVerdict(el, key, v) {
    if (v.risk_score < CFG.threshold) { removeBadge(el); return; }
    showBadge(el, key, v);
  }

  function showBadge(el, key, v) {
    ensureOverlay();
    let e = entries.get(el);
    if (!e) {
      const node = h('button', 'pill', '⚠ Nghi vấn');
      node.type = 'button';
      node.addEventListener('mouseenter', () => { clearTimeout(closeTimer); if (!pinned) openPop(el, false); });
      node.addEventListener('mouseleave', leaveClose);
      node.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (activeEl === el && pinned) closePop(); else openPop(el, true);
      });
      layer.appendChild(node);
      e = { node, key, result: v, scroller: scrollParent(el) };
      entries.set(el, e);
    }
    e.key = key;
    e.result = v;
    e.node.classList.toggle('hi', v.risk_score >= 70);
    schedulePosition();
  }

  function removeBadge(el) {
    const e = entries.get(el);
    if (!e) return;
    e.node.remove();
    entries.delete(el);
    if (activeEl === el) closePop();
  }

  function clearBadges() {
    for (const el of [...entries.keys()]) removeBadge(el);
    closePop();
  }

  function schedulePosition() {
    if (posQueued) return;
    posQueued = true;
    requestAnimationFrame(position);
  }

  function position() {
    posQueued = false;
    try {
      const vw = window.innerWidth, vh = window.innerHeight;
      for (const [el, e] of entries) {
        if (!el.isConnected || elKey.get(el) !== e.key) { removeBadge(el); continue; }
        const r = el.getBoundingClientRect();
        let visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
        let s = null;
        if (visible && e.scroller) {
          s = e.scroller.getBoundingClientRect();
          visible = r.top >= s.top + 2 && r.top <= s.bottom - 14; // bị cuộn khuất khỏi khung chat thì ẩn badge
        }
        e.node.hidden = !visible;
        if (!visible) { if (activeEl === el) closePop(); continue; }
        const w = e.node.offsetWidth || 80;
        let left = Math.min(r.right - 10, vw - w - 4);
        if (s) left = Math.min(left, s.right - w - 2);
        left = Math.max(4, left);
        e.node.style.left = left + 'px';
        e.node.style.top = Math.max(2, r.top - 11) + 'px';
      }
      if (activeEl) positionPop();
    } catch { /* fail-safe */ }
  }

  // ---------- popover ----------
  function openPop(el, pin) {
    const e = entries.get(el);
    if (!e) return;
    activeEl = el;
    pinned = pin;
    const res = e.result;
    pop.textContent = '';
    pop.classList.toggle('hi', res.risk_score >= 70);

    const hd = h('div', 'hd');
    hd.appendChild(h('span', '', `Nghi vấn lừa đảo · ${res.risk_score}/100`));
    const x = h('button', 'x', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Đóng');
    x.addEventListener('click', (ev) => { ev.stopPropagation(); closePop(); });
    hd.appendChild(x);
    pop.appendChild(hd);

    if (res.tactics.length) {
      pop.appendChild(h('div', 'lb', 'Chiêu thức'));
      const box = h('div');
      res.tactics.forEach((t) => box.appendChild(h('span', 'tag', t)));
      pop.appendChild(box);
    }
    if (res.translation) {
      pop.appendChild(h('div', 'lb', 'Ý đồ có thể có'));
      pop.appendChild(h('div', '', res.translation));
    }
    if (res.highlights.length) {
      pop.appendChild(h('div', 'lb', 'Cụm đáng ngờ'));
      const ul = h('ul');
      res.highlights.forEach((t) => { const li = h('li'); li.appendChild(h('mark', '', t)); ul.appendChild(li); });
      pop.appendChild(ul);
    }
    pop.hidden = false;
    positionPop();
  }

  function positionPop() {
    const e = activeEl && entries.get(activeEl);
    if (!e || e.node.hidden) { closePop(); return; }
    const b = e.node.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = pop.offsetWidth || 280, ph = pop.offsetHeight || 120;
    const left = Math.max(8, Math.min(b.left - 8, vw - pw - 8));
    let top = b.bottom + 6;
    if (top + ph > vh - 8) top = Math.max(8, b.top - ph - 6);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function closePop() {
    clearTimeout(closeTimer);
    activeEl = null;
    pinned = false;
    if (pop) pop.hidden = true;
  }

  function leaveClose() {
    if (pinned) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(closePop, 180);
  }

  // ---------- khởi động ----------
  function start(adapter) {
    if (state.adapter) return;
    state.adapter = adapter;

    const onlyOurs = (m) => {
      const n = m.addedNodes.length + m.removedNodes.length;
      if (!n || !host) return false;
      return [...m.addedNodes, ...m.removedNodes].every((x) => x === host);
    };
    new MutationObserver((muts) => {
      if (muts.every(onlyOurs)) return;
      schedule();
      schedulePosition();
    }).observe(document.documentElement, { childList: true, subtree: true });

    // Đổi hội thoại / mở mục người lạ / tin nhắn chờ: quét lại ngay sau cú click.
    document.addEventListener('click', (ev) => {
      try {
        if (pop && !pop.hidden && host && !ev.composedPath().includes(host)) closePop();
      } catch { /* bỏ qua */ }
      schedule();
      setTimeout(schedule, 700);
    }, true);
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && activeEl) closePop(); }, true);

    // Cuộn khung chat: quét thêm tin mới lộ ra và đặt lại vị trí badge.
    window.addEventListener('scroll', () => { schedule(); schedulePosition(); }, { capture: true, passive: true });
    window.addEventListener('resize', schedulePosition, { passive: true });

    // Điều hướng kiểu SPA không tải lại trang.
    setInterval(() => {
      if (location.href !== state.lastHref) {
        state.lastHref = location.href;
        closePop();
        schedule();
      }
    }, 700);

    // Quét tin có sẵn ngay khi vào luồng chat (React có thể render muộn nên quét lại vài lần).
    schedule();
    setTimeout(schedule, 1500);
    setTimeout(schedule, 4000);
  }

  globalThis.GuardScanner = Object.freeze({ start, scanVisibleMessages: () => { if (state.adapter) scanVisibleMessages(); }, isRightAligned, scrollParent, textOf });
})();
