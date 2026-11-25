// Server RAM-only / Zero-Retention: không database, không ghi log nội dung tin nhắn.
try { process.loadEnvFile('.env'); } catch { /* không có .env cũng được */ }

const http = require('node:http');
const { analyze } = require('./ai-analyzer');

const PORT = process.env.PORT || 3000;
const MAX_BODY = 16 * 1024;

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Cache-Control', 'no-store');
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// Đọc body tối đa MAX_BODY byte. Vượt giới hạn: bỏ phần dư (không lưu) và báo 'too_large'.
function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    let exceeded = false;
    req.on('data', (c) => {
      if (exceeded) return;
      size += c.length;
      if (size > MAX_BODY) {
        exceeded = true;
        chunks = null;
        reject(new Error('too_large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks).toString('utf8')); chunks = null; });
    req.on('error', (e) => { chunks = null; reject(e); });
  });
}

const server = http.createServer(async (req, res) => {
  setCors(req, res);
  const path = (req.url || '').split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && (path === '/' || path === '/health')) {
    return send(res, 200, { status: 'ok', service: 'zalo-guard-api' });
  }

  if (req.method === 'POST' && path === '/api/analyze-text') {
    let body = null;
    let text = null;
    try {
      body = await readBody(req);

      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return send(res, 400, { error: 'Body không phải JSON hợp lệ' });
      }
      body = null;

      text = parsed && typeof parsed === 'object' ? parsed.text : undefined;
      parsed = null;
      if (typeof text !== 'string' || !text.trim()) {
        return send(res, 400, { error: 'text phải là chuỗi không rỗng' });
      }

      const result = await analyze(text);
      return send(res, 200, result);
    } catch (e) {
      // Chỉ log e.message, không bao giờ log nội dung tin nhắn.
      console.error('analyze failed:', e.message);
      if (e.message === 'too_large') return send(res, 413, { error: 'Nội dung quá lớn' });
      return send(res, 500, { error: 'Không phân tích được' });
    } finally {
      text = null; // giải phóng nội dung ngay sau khi trả kết quả
      body = null;
    }
  }

  send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => console.log(`Server chạy tại http://localhost:${PORT}`));
