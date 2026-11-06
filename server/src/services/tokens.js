const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { User, Role, Permission, Student, Hostel, RefreshToken } = require('../models');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Builds the access-token claims: role name for display, permission codes for RBAC,
// and the ids needed for contextual checks (student id / warden's hostel id).
async function buildClaims(userId) {
  const user = await User.findByPk(userId, {
    include: [
      { model: Role, include: [{ model: Permission, through: { attributes: [] } }] },
      { model: Student, attributes: ['id'] },
      { model: Hostel, as: 'wardenOf', attributes: ['id'] },
    ],
  });
  if (!user || !user.isActive || user.approvalStatus !== 'APPROVED') return null;
  return {
    user,
    claims: {
      sub: String(user.id),
      role: user.role.name,
      perms: user.role.permissions.map((p) => p.code),
      sid: user.student?.id ?? undefined,
      hid: user.wardenOf?.id ?? undefined,
    },
  };
}

function signAccessToken(claims) {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL });
}

// Refresh tokens are opaque random strings. Only their SHA-256 hash is stored,
// so a database leak does not leak usable tokens.
async function issueRefreshToken(userId, transaction) {
  const raw = crypto.randomBytes(48).toString('base64url');
  await RefreshToken.create(
    {
      userId,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000),
    },
    { transaction }
  );
  return raw;
}

module.exports = { buildClaims, signAccessToken, issueRefreshToken, sha256 };
