const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const handler = (req, res) =>
  res.status(429).json({
    error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts, please try again later', requestId: req.id },
  });

// Brute-force protection on login/refresh.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: env.AUTH_RATE_LIMIT, standardHeaders: 'draft-7', legacyHeaders: false, handler });

const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false, handler });

module.exports = { authLimiter, apiLimiter };
