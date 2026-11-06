const { forbidden, unauthorized } = require('../lib/errors');

// Custom middleware #3: RBAC driven by PERMISSIONS, never by comparing role names.
// requirePermission('receipt:verify') or requirePermission(['a', 'b']) => user needs ANY of them.
function requirePermission(perms) {
  const needed = Array.isArray(perms) ? perms : [perms];
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    const ok = needed.some((p) => req.user.permissions.has(p));
    return ok ? next() : next(forbidden());
  };
}

// Contextual authorisation: a warden may act only on their own hostel.
// Users holding 'hostel:all' (admin) bypass the scope check.
function assertHostelScope(user, hostelId) {
  if (user.permissions.has('hostel:all')) return;
  if (!user.hostelId || Number(user.hostelId) !== Number(hostelId)) {
    throw forbidden('You can only manage your own hostel');
  }
}

module.exports = { requirePermission, assertHostelScope };
