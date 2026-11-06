const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const env = require('../../config/env');
const sequelize = require('../../lib/db');
const { User, RefreshToken, Role, Student } = require('../../models');
const { buildClaims, signAccessToken, issueRefreshToken, sha256 } = require('../../services/tokens');
const validate = require('../../middleware/validate');
const authenticate = require('../../middleware/authenticate');
const { authLimiter } = require('../../middleware/rateLimit');
const { unauthorized, forbidden, conflict, AppError } = require('../../lib/errors');
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

// Password policy shared by registration, password change and admin-created accounts.
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Z]/, 'Password needs an uppercase letter')
  .regex(/[a-z]/, 'Password needs a lowercase letter')
  .regex(/[0-9]/, 'Password needs a digit');

function publicUser(user, claims) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    mustChangePassword: !!user.mustChangePassword,
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
    // Correct password but not yet approved: 403, not 401 — identity is proven, access is not granted.
    if (user.approvalStatus === 'PENDING') throw new AppError(403, 'ACCOUNT_PENDING', 'Your registration is waiting for admin approval');
    if (user.approvalStatus === 'REJECTED') throw new AppError(403, 'ACCOUNT_REJECTED', 'Your registration was not approved. Contact the hostel office.');

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
// ---------- Student self-registration (starts PENDING until an admin approves) ----------
const registerSchema = z.object({
  name: z.string().trim().min(3, 'Enter your full name').max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
  password: passwordSchema,
  rollNo: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/, 'Roll number: 4–20 letters/digits'),
  gender: z.enum(['MALE', 'FEMALE']),
  year: z.number().int().min(1).max(5),
  program: z.string().trim().min(2).max(40),
  cgpa: z.number().min(0).max(10),
  isPwd: z.boolean().default(false),
});

router.post('/register', authLimiter, validate({ body: registerSchema }), async (req, res, next) => {
  try {
    const b = req.body;
    const passwordHash = await bcrypt.hash(b.password, env.BCRYPT_ROUNDS);
    const user = await sequelize.transaction(async (t) => {
      if (await User.findOne({ where: { email: b.email }, transaction: t })) throw conflict('An account with this email already exists');
      if (await Student.findOne({ where: { rollNo: b.rollNo }, transaction: t })) throw conflict('This roll number is already registered');
      const role = await Role.findOne({ where: { name: 'student' }, transaction: t });
      const u = await User.create(
        { email: b.email, name: b.name, phone: b.phone, passwordHash, roleId: role.id, approvalStatus: 'PENDING' },
        { transaction: t }
      );
      await Student.create(
        { userId: u.id, rollNo: b.rollNo, gender: b.gender, year: b.year, program: b.program, cgpa: b.cgpa, isPwd: b.isPwd },
        { transaction: t }
      );
      return u;
    });
    audit({ action: 'STUDENT_REGISTERED', actor: { id: user.id, role: 'student' }, entity: 'user', entityId: user.id, requestId: req.id });
    res.status(201).json({ data: { id: user.id, email: user.email, approvalStatus: 'PENDING' }, message: 'Registration received. You can log in once an admin approves it.' });
  } catch (err) {
    next(err);
  }
});

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

const profileSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number').nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, 'Nothing to update');

router.patch('/me', authenticate, validate({ body: profileSchema }), async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id);
    await user.update(req.body);
    const built = await buildClaims(user.id);
    res.json({ user: publicUser(built.user, built.claims) });
  } catch (err) {
    next(err);
  }
});

const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema })
  .refine((v) => v.currentPassword !== v.newPassword, { message: 'New password must differ from the current one', path: ['newPassword'] });

// Changing the password revokes every refresh token (signs out other devices), then issues a fresh session.
router.post('/change-password', authenticate, authLimiter, validate({ body: changePasswordSchema }), async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) throw forbidden('Current password is incorrect');
    const passwordHash = await bcrypt.hash(req.body.newPassword, env.BCRYPT_ROUNDS);
    const refreshToken = await sequelize.transaction(async (t) => {
      await user.update({ passwordHash, mustChangePassword: false }, { transaction: t });
      await RefreshToken.update({ revokedAt: new Date() }, { where: { userId: user.id, revokedAt: null }, transaction: t });
      return issueRefreshToken(user.id, t);
    });
    res.cookie(COOKIE, refreshToken, cookieOpts());
    const built = await buildClaims(user.id);
    audit({ action: 'PASSWORD_CHANGED', actor: req.user, entity: 'user', entityId: user.id, requestId: req.id });
    res.json({ accessToken: signAccessToken(built.claims), user: publicUser(built.user, built.claims) });
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
