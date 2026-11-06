const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const env = require('../../config/env');
const sequelize = require('../../lib/db');
const { User, RefreshToken } = require('../../models');
const { buildClaims, signAccessToken, issueRefreshToken, sha256 } = require('../../services/tokens');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const { authLimiter } = require('../../middleware/rateLimit');
const { unauthorized } = require('../../lib/errors');
const { audit } = require('../../services/audit');

const router = express.Router();

// Refresh token lives in an httpOnly cookie scoped to /api/v1/auth: JavaScript can never
// read it (XSS-safe). The access token is short-lived and kept in memory by the client.
const COOKIE = 'hra_refresh';
const cookieOpts = () => ({
  httpOnly: true,
  secure: env.isProd,
  sameSite: env.isProd ? 'none' : 'lax', // 'none' is required when client and API are on different domains
  path: '/api/v1/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000,
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, 'Password is required').max(128),
});

function publicUser(user, claims) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: claims.role,
    permissions: claims.perms,
    studentId: claims.sid ?? null,
    hostelId: claims.hid ?? null,
  };
}

router.post('/login', authLimiter, validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email } });
    // Same message whether the email or the password is wrong: no account enumeration.
    const ok = user && user.isActive && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) throw unauthorized('Invalid email or password');

    const { claims } = await buildClaims(user.id);
    const accessToken = signAccessToken(claims);
    const refreshToken = await issueRefreshToken(user.id);
    res.cookie(COOKIE, refreshToken, cookieOpts());
    audit({ action: 'LOGIN', actor: { id: user.id, role: claims.role }, entity: 'user', entityId: user.id, requestId: req.id });
    res.json({ accessToken, user: publicUser(user, claims) });
  } catch (err) {
    next(err);
  }
});

// Rotation: each refresh token is single-use. Reusing a revoked token revokes every
// session of that user, which shuts out an attacker who stole an old token.
router.post('/refresh', authLimiter, async (req, res, next) => {
  try {
    const raw = req.cookies?.[COOKIE];
    if (!raw) throw unauthorized('No refresh token');

    const result = await sequelize.transaction(async (t) => {
      const row = await RefreshToken.findOne({
        where: { tokenHash: sha256(raw) },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (!row) return { error: 'Invalid refresh token' };
      if (row.revokedAt) {
        await RefreshToken.update({ revokedAt: new Date() }, { where: { userId: row.userId, revokedAt: null }, transaction: t });
        return { error: 'Refresh token reuse detected; all sessions revoked' };
      }
      if (row.expiresAt < new Date()) return { error: 'Refresh token expired' };

      await row.update({ revokedAt: new Date() }, { transaction: t });
      const next = await issueRefreshToken(row.userId, t);
      return { userId: row.userId, next };
    });

    if (result.error) {
      res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined });
      throw unauthorized(result.error);
    }
    const built = await buildClaims(result.userId);
    if (!built) throw unauthorized('Account disabled');
    res.cookie(COOKIE, result.next, cookieOpts());
    res.json({ accessToken: signAccessToken(built.claims), user: publicUser(built.user, built.claims) });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const raw = req.cookies?.[COOKIE];
    if (raw) await RefreshToken.update({ revokedAt: new Date() }, { where: { tokenHash: sha256(raw), revokedAt: null } });
    res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const built = await buildClaims(req.user.id);
    if (!built) throw unauthorized('Account disabled');
    res.json({ user: publicUser(built.user, built.claims) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
