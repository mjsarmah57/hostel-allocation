const path = require('path');
const fs = require('fs');
const express = require('express');
const { z } = require('zod');
const { QueryTypes } = require('sequelize');
const sequelize = require('../../lib/db');
const { Allocation, Bed, Room, Hostel, FeeReceipt, Student, ACTIVE_STATUSES } = require('../../models');
const validate = require('../../middleware/validate');
const { requirePermission, assertHostelScope } = require('../../middleware/authorize');
const { receiptUpload, verifyMagicBytes, RECEIPT_DIR } = require('../../middleware/upload');
const { parseListQuery, pageMeta } = require('../../lib/pagination');
const { resolveSession } = require('../../services/rounds');
const { transitionAllocation, submitReceipt, TRANSITIONS } = require('../../services/allocation');
const { audit, notify } = require('../../services/audit');
const { notFound, forbidden } = require('../../lib/errors');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const STATUSES = Object.keys(TRANSITIONS);

const detailInclude = [
  { model: Bed, attributes: ['id', 'label'], include: [{ model: Room, attributes: ['id', 'roomNo', 'floor'], include: [{ model: Hostel, attributes: ['id', 'name', 'code'] }] }] },
  { model: FeeReceipt, attributes: ['id', 'originalName', 'mimeType', 'sizeBytes', 'uploadedAt', 'verifiedAt'] },
];

function withNextActions(a) {
  const json = a.toJSON ? a.toJSON() : a;
  return { ...json, allowedNext: Object.keys(TRANSITIONS[json.status] || {}) };
}

// ---------- Student: my allocation ----------
router.get('/me', requirePermission('allocation:read_own'), async (req, res, next) => {
  try {
    const session = await resolveSession(req.query.session);
    const current = await Allocation.findOne({
      where: { studentId: req.user.studentId, session, status: ACTIVE_STATUSES },
      include: detailInclude,
    });
    const history = await Allocation.findAll({
      where: { studentId: req.user.studentId },
      include: detailInclude,
      order: [['createdAt', 'DESC']],
      limit: 20,
    });
    res.json({ session, data: current ? withNextActions(current) : null, history });
  } catch (err) {
    next(err);
  }
});

// ---------- Warden / admin: list with pagination, filters, sorting ----------
const listQuery = z.object({
  session: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  hostelId: z.coerce.number().int().positive().optional(),
  status: z.enum(STATUSES).optional(),
  q: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.string().optional(),
});
const SORT = { createdAt: 'a.created_at', rollNo: 's.roll_no', roomNo: 'r.room_no', status: 'a.status', feeDueAt: 'a.fee_due_at' };

router.get('/', requirePermission('allocation:read'), validate({ query: listQuery }), async (req, res, next) => {
  try {
    const q = req.validatedQuery;
    const session = await resolveSession(q.session);
    let hostelId = q.hostelId;
    if (!req.user.permissions.has('hostel:all')) {
      if (hostelId && hostelId !== req.user.hostelId) throw forbidden('You can only view your own hostel');
      hostelId = req.user.hostelId;
      if (!hostelId) throw forbidden('No hostel assigned to you');
    }
    const list = parseListQuery(q, SORT, '-createdAt');
    const where = ['a.session = :session'];
    if (hostelId) where.push('h.id = :hostelId');
    if (q.status) where.push('a.status = :status');
    if (q.q) where.push("(s.roll_no ILIKE :like OR u.name ILIKE :like)");

    const rows = await sequelize.query(
      `SELECT a.id, a.status, a.source, a.fee_due_at AS "feeDueAt", a.created_at AS "createdAt",
              s.id AS "studentId", s.roll_no AS "rollNo", u.name AS "studentName", s.year, s.cgpa,
              h.id AS "hostelId", h.name AS "hostelName", r.room_no AS "roomNo", r.floor, b.label AS "bedLabel",
              EXISTS (SELECT 1 FROM fee_receipts fr WHERE fr.allocation_id = a.id) AS "hasReceipt",
              COUNT(*) OVER()::int AS total_count
         FROM allocations a
         JOIN students s ON s.id = a.student_id
         JOIN users u ON u.id = s.user_id
         JOIN beds b ON b.id = a.bed_id
         JOIN rooms r ON r.id = b.room_id
         JOIN hostels h ON h.id = r.hostel_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${list.orderSql}, a.id DESC
        LIMIT :limit OFFSET :offset`,
      {
        replacements: { session, hostelId, status: q.status, like: `%${q.q || ''}%`, limit: list.limit, offset: list.offset },
        type: QueryTypes.SELECT,
      }
    );
    const total = rows[0]?.total_count ?? 0;
    res.json({
      session,
      data: rows.map(({ total_count, ...r }) => ({ ...r, allowedNext: Object.keys(TRANSITIONS[r.status] || {}) })),
      meta: pageMeta(list, total),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission(['allocation:read', 'allocation:read_own']), validate({ params: idParam }), async (req, res, next) => {
  try {
    const a = await Allocation.findByPk(req.params.id, { include: [...detailInclude, { model: Student, attributes: ['id', 'rollNo', 'year'] }] });
    if (!a) throw notFound('Allocation');
    if (req.user.studentId) {
      if (a.studentId !== req.user.studentId) throw forbidden('This is not your allocation');
    } else {
      assertHostelScope(req.user, a.bed.room.hostel.id);
    }
    res.json({ data: withNextActions(a) });
  } catch (err) {
    next(err);
  }
});

// ---------- State transitions (warden / admin) ----------
const transitionSchema = z.object({
  status: z.enum(['VERIFIED', 'ALLOCATED', 'CHECKED_IN', 'VACATED', 'RELEASED']),
  note: z.string().trim().max(300).optional(),
});

router.patch(
  '/:id/status',
  requirePermission(['allocation:update', 'receipt:verify', 'allocation:release']),
  validate({ params: idParam, body: transitionSchema }),
  async (req, res, next) => {
    try {
      const result = await transitionAllocation({ allocationId: req.params.id, to: req.body.status, user: req.user, note: req.body.note });
      audit({
        action: 'ALLOCATION_STATUS_CHANGED', actor: req.user, entity: 'allocation', entityId: result.allocation.id,
        session: result.allocation.session, data: { from: result.from, to: result.to, note: result.note }, requestId: req.id,
      });
      const student = await Student.findByPk(result.allocation.studentId, { attributes: ['userId'] });
      const msg = result.from === 'FEE_SUBMITTED' && result.to === 'ALLOCATED'
        ? `Your fee receipt was rejected${result.note ? `: ${result.note}` : ''}. Please upload a valid one within 3 days.`
        : `Your allocation is now ${result.to}.`;
      if (student) notify(student.userId, 'STATUS', msg);
      res.json({ data: withNextActions(result.allocation) });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- Fee receipt upload (student) ----------
router.post(
  '/:id/receipt',
  requirePermission('receipt:upload'),
  validate({ params: idParam }),
  receiptUpload,
  verifyMagicBytes,
  async (req, res, next) => {
    try {
      const { allocation, receipt } = await submitReceipt({ allocationId: req.params.id, studentId: req.user.studentId, file: req.file });
      audit({ action: 'RECEIPT_UPLOADED', actor: req.user, entity: 'allocation', entityId: allocation.id, session: allocation.session, data: { receiptId: receipt.id, size: receipt.sizeBytes }, requestId: req.id });
      res.status(201).json({
        data: { receipt: { id: receipt.id, originalName: receipt.originalName, mimeType: receipt.mimeType, sizeBytes: receipt.sizeBytes }, allocationStatus: allocation.status },
      });
    } catch (err) {
      if (req.file) fs.unlink(req.file.path, () => {}); // keep the disk clean when the business rule fails
      next(err);
    }
  }
);

// Receipts are NOT served as public static files: every download is authorised.
router.get(
  '/:id/receipt',
  requirePermission(['receipt:verify', 'allocation:read_own']),
  validate({ params: idParam }),
  async (req, res, next) => {
    try {
      const a = await Allocation.findByPk(req.params.id, { include: detailInclude });
      if (!a) throw notFound('Allocation');
      if (req.user.studentId) {
        if (a.studentId !== req.user.studentId) throw forbidden('This is not your allocation');
      } else {
        assertHostelScope(req.user, a.bed.room.hostel.id);
      }
      const receipt = [...(a.fee_receipts || [])].sort((x, y) => new Date(y.uploadedAt) - new Date(x.uploadedAt))[0];
      if (!receipt) throw notFound('Receipt');
      const full = await FeeReceipt.findByPk(receipt.id);
      const file = path.join(RECEIPT_DIR, path.basename(full.filePath));
      if (!fs.existsSync(file)) throw notFound('Receipt file');
      res.setHeader('Content-Type', full.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(full.originalName)}"`);
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
