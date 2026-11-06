const crypto = require('crypto');

// Custom middleware #1: every request gets an ID that appears in logs and error responses.
module.exports = function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
