// Vercel Serverless Function: POST /api/analyze-text (RAM-only / Zero-Retention)
const { analyze } = require('../ai-analyzer');
const { setCors, send, readBody } = require('../lib/http');

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return send(res, 405, { error: 'Method not allowed' });
  }

  let body = null;
  let parsed = null;
  let text = null;
  try {
    body = await readBody(req);
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
    text = null;
    body = null;
    parsed = null;
  }
};

// Tắt bodyParser mặc định để tự giới hạn 16KB khi đọc stream.
module.exports.config = { api: { bodyParser: false } };
