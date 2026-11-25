// Tiện ích dùng chung cho các Serverless Function (để ngoài api/ để Vercel không coi là endpoint).
const ALLOWED_ORIGIN = 'https://chat.zalo.me';
const MAX_BODY = 16 * 1024;

function setCors(req, res) {
  const origin = req.headers.origin;
  // Extension gọi qua service worker (origin chrome-extension://) nên cũng được phép.
  if (origin === ALLOWED_ORIGIN || (origin && origin.startsWith('chrome-extension://'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Cache-Control', 'no-store');
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
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

module.exports = { setCors, send, readBody, MAX_BODY };
