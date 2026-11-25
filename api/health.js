// Vercel Serverless Function: GET /api/health
const { setCors, send } = require('../lib/http');

module.exports = function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return send(res, 405, { error: 'Method not allowed' });
  }
  return send(res, 200, { status: 'ok', service: 'zalo-guard-api' });
};
