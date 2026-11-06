const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const { QueryTypes, Op } = require('sequelize');
const env = require('../../config/env');
const sequelize = require('../../lib/db');
const { User, Role, Student, Hostel, RefreshToken } = require('../../models');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { parseListQuery, pageMeta } = require('../../lib/pagination');
const { AppError, conflict, notFound, unprocessable, badRequest } = require('../../lib/errors');
const { audit, notify } = require('../../services/audit');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });

// Readable one-time password, e.g. "Hostel-7Q4K-92" (meets the password policy).
const tempPassword = () => `Hostel-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomInt(10, 99)}`;

// ---------- List users (admin) ----------
const listQuery = z.object({
  role: z.enum(['student', 'warden', 'admin']).optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  active: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.string().optional(),
});
const SORT = { createdAt: 'u.created_at', name: 'u.name', email: 'u.email', rollNo: 's.roll_no' };

router.get('/', requirePermission('user:manage'), validate({ query: listQuery }), async (req, res, next) => {
  try {
    const q = req.validatedQuery;
    const list = parseListQuery(q, SORT, '-createdAt');
    const where = ['TRUE'];
    if (q.role) where.push('r.name = :role');
    if (q.status) where.push('u.approval_status = :status');
    if (q.active) where.push('u.is_active = :active');
    if (q.q) where.push('(u.name ILIKE :like OR u.email ILIKE :like OR s.roll_no ILIKE :like)');
    const rows = await sequelize.query(
      `SELECT u.id, u.name, u.email, u.phone, u.is_active AS "isActive", u.approval_status AS "approvalStatus",
              u.created_at AS "createdAt", r.name AS role,
              s.id AS "studentId", s.roll_no AS "rollNo", s.gender, s.year, s.program, s.cgpa, s.is_pwd AS "isPwd",
              h.id AS "hostelId", h.name AS "hostelName",
              COUNT(*) OVER()::int AS total_count
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN students s ON s.user_id = u.id
         LEFT JOIN hostels h ON h.warden_id = u.id
        WHERE ${where.join(' AND ')}
        ORDER BY ${list.orderSql}, u.id DESC
        LIMIT :limit OFFSET :offset`,
      {
        replacements: { role: q.role, status: q.status, active: q.active === 'true', like: `%${q.q || ''}%`, limit: list.limit, offset: list.offset },
        type: QueryTypes.SELECT,
      }
    );
    const total = rows[0]?.total_count ?? 0;
    res.json({ data: rows.map(({ total_count, ...r }) => r), meta: pageMeta(list, total) });
  } catch (err) {
    next(err);
  }
});

// ---------- Approve / reject a self-registration ----------
router.patch(
  '/:id/approval',
  requirePermission('student:approve'),
  validate({ params: idParam, body: z.object({ approve: z.boolean(), reason: z.string().trim().max(300).optional() }) }),
  async (req, res, next) => {
    try {
      const user = await sequelize.transaction(async (t) => {
        const u = await User.findByPk(req.params.id, { lock: t.LOCK.UPDATE, transaction: t });
        if (!u) throw notFound('User');
        if (u.approvalStatus !== 'PENDING') throw conflict(`Registration is already ${u.approvalStatus}`);
        return u.update({ approvalStatus: req.body.approve ? 'APPROVED' : 'REJECTED' }, { transaction: t });
      });
      audit({ action: req.body.approve ? 'REGISTRATION_APPROVED' : 'REGISTRATION_REJECTED', actor: req.user, entity: 'user', entityId: user.id, data: { reason: req.body.reason }, requestId: req.id });
      notify(user.id, 'ACCOUNT', req.body.approve ? 'Your registration was approved. Welcome!' : `Your registration was not approved${req.body.reason ? `: ${req.body.reason}` : ''}.`);
      res.json({ data: { id: user.id, approvalStatus: user.approvalStatus } });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- Create a warden account (admin) ----------
const wardenSchema = z.object({
  name: z.string().trim().min(3).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number').optional(),
  hostelId: z.number().int().positive().optional(),
});

router.post('/wardens', requirePermission('user:manage'), validate({ body: wardenSchema }), async (req, res, next) => {
  try {
    const password = tempPassword();
    const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
    const result = await sequelize.transaction(async (t) => {
      if (await User.findOne({ where: { email: req.body.email }, transaction: t })) throw conflict('An account with this email already exists');
      const role = await Role.findOne({ where: { name: 'warden' }, transaction: t });
      const u = await User.create(
        { name: req.body.name, email: req.body.email, phone: req.body.phone, passwordHash, roleId: role.id, mustChangePassword: true },
        { transaction: t }
      );
      let hostel = null;
      if (req.body.hostelId) {
        hostel = await Hostel.findByPk(req.body.hostelId, { lock: t.LOCK.UPDATE, transaction: t });
        if (!hostel) throw notFound('Hostel');
        await hostel.update({ wardenId: u.id }, { transaction: t }); // replaces any previous warden
      }
      return { u, hostel };
    });
    audit({ action: 'WARDEN_CREATED', actor: req.user, entity: 'user', entityId: result.u.id, data: { hostelId: result.hostel?.id }, requestId: req.id });
    res.status(201).location(`/api/v1/users/${result.u.id}`).json({
      data: { id: result.u.id, name: result.u.name, email: result.u.email, hostel: result.hostel?.name ?? null },
      temporaryPassword: password, // shown ONCE; the warden must change it at first login
    });
  } catch (err) {
    next(err);
  }
});

// ---------- Activate / deactivate, reassign warden ----------
router.patch(
  '/:id',
  requirePermission('user:manage'),
  validate({ params: idParam, body: z.object({ isActive: z.boolean().optional(), hostelId: z.number().int().positive().nullable().optional() }).refine((v) => Object.keys(v).length, 'Nothing to update') }),
  async (req, res, next) => {
    try {
      if (req.params.id === req.user.id && req.body.isActive === false) throw unprocessable('You cannot deactivate your own account');
      const user = await sequelize.transaction(async (t) => {
        const u = await User.findByPk(req.params.id, { include: [Role], lock: { level: t.LOCK.UPDATE, of: User }, transaction: t });
        if (!u) throw notFound('User');
        if (req.body.isActive !== undefined) {
          await u.update({ isActive: req.body.isActive }, { transaction: t });
          if (!req.body.isActive) await RefreshToken.update({ revokedAt: new Date() }, { where: { userId: u.id, revokedAt: null }, transaction: t });
        }
        if (req.body.hostelId !== undefined) {
          if (u.role.name !== 'warden') throw unprocessable('Only wardens can be assigned to a hostel');
          await Hostel.update({ wardenId: null }, { where: { wardenId: u.id }, transaction: t });
          if (req.body.hostelId) {
            const h = await Hostel.findByPk(req.body.hostelId, { transaction: t });
            if (!h) throw notFound('Hostel');
            await h.update({ wardenId: u.id }, { transaction: t });
          }
        }
        return u;
      });
      audit({ action: 'USER_UPDATED', actor: req.user, entity: 'user', entityId: user.id, data: req.body, requestId: req.id });
      res.json({ data: { id: user.id, isActive: user.isActive } });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- Reset password (admin) ----------
router.post('/:id/reset-password', requirePermission('user:manage'), validate({ params: idParam }), async (req, res, next) => {
  try {
    const password = tempPassword();
    const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
    const user = await sequelize.transaction(async (t) => {
      const u = await User.findByPk(req.params.id, { lock: t.LOCK.UPDATE, transaction: t });
      if (!u) throw notFound('User');
      await u.update({ passwordHash, mustChangePassword: true }, { transaction: t });
      await RefreshToken.update({ revokedAt: new Date() }, { where: { userId: u.id, revokedAt: null }, transaction: t });
      return u;
    });
    audit({ action: 'PASSWORD_RESET', actor: req.user, entity: 'user', entityId: user.id, requestId: req.id });
    res.json({ data: { id: user.id, email: user.email }, temporaryPassword: password });
  } catch (err) {
    next(err);
  }
});

// ---------- Bulk student import from CSV (admin) ----------
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = ['text/csv', 'application/vnd.ms-excel', 'text/plain'].includes(file.mimetype) || /\.csv$/i.test(file.originalname);
    return ok ? cb(null, true) : cb(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Upload a .csv file'));
  },
}).single('file');

// Minimal RFC-4180 parser: handles quoted fields, escaped quotes and CRLF.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const csvRow = z.object({
  name: z.string().trim().min(3, 'name too short').max(120),
  email: z.string().trim().toLowerCase().email('invalid email'),
  rollNo: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/, 'invalid roll number'),
  gender: z.string().trim().toUpperCase().pipe(z.enum(['MALE', 'FEMALE'], { message: 'gender must be MALE or FEMALE' })),
  year: z.coerce.number().int().min(1, 'year 1–5').max(5, 'year 1–5'),
  program: z.string().trim().min(2).max(40),
  cgpa: z.coerce.number().min(0, 'cgpa 0–10').max(10, 'cgpa 0–10'),
  phone: z.string().trim().regex(/^([6-9]\d{9})?$/, 'invalid phone').optional(),
});
const REQUIRED = ['name', 'email', 'rollno', 'gender', 'year', 'program', 'cgpa'];

router.post('/import', requirePermission('user:manage'), csvUpload, async (req, res, next) => {
  try {
    if (!req.file) throw unprocessable('Attach a CSV file in the "file" field');
    const rows = parseCsv(req.file.buffer.toString('utf8').replace(/^﻿/, ''));
    if (rows.length < 2) throw unprocessable('The CSV has no data rows');
    const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s_]/g, ''));
    const missing = REQUIRED.filter((h) => !header.includes(h));
    if (missing.length) throw unprocessable(`Missing column(s): ${missing.join(', ')}`, { expected: [...REQUIRED, 'phone (optional)'] });
    if (rows.length > 2001) throw badRequest('At most 2,000 students per import');

    const idx = (k) => header.indexOf(k);
    const errors = [];
    const valid = [];
    rows.slice(1).forEach((r, i) => {
      const parsed = csvRow.safeParse({
        name: r[idx('name')], email: r[idx('email')], rollNo: r[idx('rollno')], gender: r[idx('gender')],
        year: r[idx('year')], program: r[idx('program')], cgpa: r[idx('cgpa')], phone: idx('phone') >= 0 ? r[idx('phone')] : undefined,
      });
      if (!parsed.success) errors.push({ line: i + 2, errors: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`) });
      else valid.push({ line: i + 2, ...parsed.data });
    });

    // Duplicates inside the file and against the database.
    const seen = new Set();
    const fresh = [];
    const emails = valid.map((v) => v.email);
    const rolls = valid.map((v) => v.rollNo);
    const [existingUsers, existingStudents] = await Promise.all([
      User.findAll({ where: { email: { [Op.in]: emails } }, attributes: ['email'] }),
      Student.findAll({ where: { rollNo: { [Op.in]: rolls } }, attributes: ['rollNo'] }),
    ]);
    const takenE = new Set(existingUsers.map((u) => u.email));
    const takenR = new Set(existingStudents.map((s) => s.rollNo));
    for (const v of valid) {
      const dup = [];
      if (takenE.has(v.email) || seen.has(`e:${v.email}`)) dup.push(`email ${v.email} already exists`);
      if (takenR.has(v.rollNo) || seen.has(`r:${v.rollNo}`)) dup.push(`roll number ${v.rollNo} already exists`);
      seen.add(`e:${v.email}`);
      seen.add(`r:${v.rollNo}`);
      if (dup.length) errors.push({ line: v.line, errors: dup });
      else fresh.push(v);
    }

    const password = tempPassword();
    if (fresh.length) {
      const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
      await sequelize.transaction(async (t) => {
        const role = await Role.findOne({ where: { name: 'student' }, transaction: t });
        const users = await User.bulkCreate(
          fresh.map((v) => ({ name: v.name, email: v.email, phone: v.phone || null, passwordHash, roleId: role.id, mustChangePassword: true })),
          { transaction: t, returning: true }
        );
        await Student.bulkCreate(
          fresh.map((v, k) => ({ userId: users[k].id, rollNo: v.rollNo, gender: v.gender, year: v.year, program: v.program, cgpa: v.cgpa })),
          { transaction: t }
        );
      });
    }
    audit({ action: 'STUDENTS_IMPORTED', actor: req.user, entity: 'user', entityId: 0, data: { created: fresh.length, failed: errors.length }, requestId: req.id });
    res.status(fresh.length ? 201 : 200).json({
      data: { created: fresh.length, failed: errors.length, errors: errors.sort((a, b) => a.line - b.line).slice(0, 200) },
      ...(fresh.length ? { temporaryPassword: password } : {}),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
