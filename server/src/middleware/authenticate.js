const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { unauthorized } = require('../lib/errors');

// Custom middleware #2: verifies the Bearer access token and attaches req.user.
module.exports = function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized());
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
    req.user = {
      id: Number(payload.sub),
      role: payload.role,
      permissions: new Set(payload.perms || []),
      studentId: payload.sid ?? null,
      hostelId: payload.hid ?? null,
    };
    return next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token';
    return next(unauthorized(msg));
  }
};
