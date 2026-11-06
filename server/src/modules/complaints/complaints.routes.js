const express = require('express');
const { z } = require('zod');
const { QueryTypes } = require('sequelize');
const sequelize = require('../../lib/db');
const { Complaint, ComplaintEvent, Allocation, Bed, Room, Student, ACTIVE_STATUSES } = require('../../models');
const validate = require('../../middleware/validate');
const { requirePermission, assertHostelScope } = require('../../middleware/authorize');
const { parseListQuery, pageMeta } = require('../../lib/pagination');
const { resolveSession } = require('../../services/rounds');
const { notFound, forbidden, conflict } = require('../../lib/errors');
const { audit, notify } = require('../../services/audit');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const CATEGORIES = ['ELECTRICAL', 'PLUMBING', 'FURNITURE', 'CLEANING', 'INTERNET', 'OTHER'];
const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

// Who may move a complaint where. 'staff' = complaint:manage, 'owner' = the student who raised it.
const TRANSITIONS = {
  OPEN: { IN_PROGRESS: 'staff', RESOLVED: 'staff', CLOSED: 'owner' },
  IN_PROGRESS: { RESOLVED: 'staff', OPEN: 'staff' },
  RESOLVED: { CLOSED: 'owner', OPEN: 'owner' }, // owner confirms the fix, or reopens it
  CLOSED: {},
};

const SELECT = `
  SELECT c.id, c.title, c.description, c.category, c.priority, c.status, c.created_at AS "createdAt", c.updated_at AS "updatedAt",
         c.resolved_at AS "resolvedAt", s.id AS "studentId", s.roll_no AS "rollNo", u.name AS "studentName", u.phone AS "studentPhone",
         r.id AS "roomId", r.room_no AS "roomNo", r.floor, h.id AS "hostelId", h.name AS "hostelName"
    FROM complaints c JOIN students s ON s.id = c.student_id JOIN users u ON u.id = s.user_id
    JOIN rooms r ON r.id = c.room_id JOIN hostels h ON h.id = r.hostel_id`;

const listQuery = z.object({
  status: z.enum(STATUSES).optional(),
  category: z.enum(CATEGORIES).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  hostelId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.string().optional(),
});
const SORT = { createdAt: 'c.created_at', priority: 'c.priority', status: 'c.status', updatedAt: 'c.updated_at' };

router.get('/', requirePermission(['complaint:create', 'complaint:manage']), validate({ query: listQuery }), async (req, res, next) => {
  try {
    const f = req.validatedQuery;
    const list = parseListQuery(f, SORT, '-createdAt');
    const where = ['TRUE'];
    if (req.user.studentId) where.push('s.id = :sid');
    else if (!req.user.permissions.has('hostel:all')) where.push('h.id = :hid');
    else if (f.hostelId) where.push('h.id = :hostelId');
    if (f.status) where.push('c.status = :status');
    if (f.category) where.push('c.category = :category');
    if (f.priority) where.push('c.priority = :priority');
    if (f.q) where.push('(c.title ILIKE :like OR s.roll_no ILIKE :like OR u.name ILIKE :like OR r.room_no ILIKE :like)');
    const rows = await sequelize.query(
      `${SELECT.replace('SELECT c.id', 'SELECT COUNT(*) OVER()::int AS total_count, c.id')} WHERE ${where.join(' AND ')}
       ORDER BY ${list.orderSql}, c.id DESC LIMIT :limit OFFSET :offset`,
      {
        replacements: { ...f, sid: req.user.studentId, hid: req.user.hostelId, like: `%${f.q || ''}%`, limit: list.limit, offset: list.offset },
        type: QueryTypes.SELECT,
      }
    );
    const total = rows[0]?.total_count ?? 0;
    res.json({ data: rows.map(({ total_count, description, ...c }) => c), meta: pageMeta(list, total) });
  } catch (err) {
    next(err);
  }
});

async function loadView(id, user) {
  const [c] = await sequelize.query(`${SELECT} WHERE c.id = :id`, { replacements: { id }, type: QueryTypes.SELECT });
  if (!c) throw notFound('Complaint');
  if (user.studentId) {
    if (c.studentId !== user.studentId) throw forbidden('This is not your complaint');
  } else assertHostelScope(user, c.hostelId);
  const events = await sequelize.query(
    `SELECT e.id, e.from_status AS "fromStatus", e.to_status AS "toStatus", e.note, e.created_at AS "createdAt", u.name AS "actorName", r.name AS "actorRole"
       FROM complaint_events e JOIN users u ON u.id = e.actor_id JOIN roles r ON r.id = u.role_id
      WHERE e.complaint_id = :id ORDER BY e.created_at, e.id`,
    { replacements: { id }, type: QueryTypes.SELECT }
  );
  const role = user.studentId ? 'owner' : 'staff';
  const allowedNext = Object.entries(TRANSITIONS[c.status]).filter(([, who]) => who === role).map(([s]) => s);
  return { ...c, events, allowedNext };
}

router.get('/:id', requirePermission(['complaint:create', 'complaint:manage']), validate({ params: idParam }), async (req, res, next) => {
  try {
    res.json({ data: await loadView(req.params.id, req.user) });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  category: z.enum(CATEGORIES),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  title: z.string().trim().min(5, 'Title must be at least 5 characters').max(120),
  description: z.string().trim().min(10, 'Describe the problem in at least 10 characters').max(2000),
});

// A student can only report problems in the room they currently hold.
router.post('/', requirePermission('complaint:create'), validate({ body: createSchema }), async (req, res, next) => {
  try {
    const session = await resolveSession();
    const complaint = await sequelize.transaction(async (t) => {
      const alloc = await Allocation.findOne({
        where: { studentId: req.user.studentId, session, status: ACTIVE_STATUSES },
        include: [{ model: Bed, attributes: ['roomId'] }], transaction: t,
      });
      if (!alloc) throw conflict('You need a room this session before raising a complaint');
      const [{ open }] = await sequelize.query(
        "SELECT COUNT(*)::int AS open FROM complaints WHERE student_id = :sid AND status IN ('OPEN','IN_PROGRESS')",
        { replacements: { sid: req.user.studentId }, type: QueryTypes.SELECT, transaction: t }
      );
      if (open >= 5) throw conflict('You already have 5 unresolved complaints; wait for those to be handled');
      const c = await Complaint.create({ ...req.body, studentId: req.user.studentId, roomId: alloc.bed.roomId }, { transaction: t });
      await ComplaintEvent.create({ complaintId: c.id, actorId: req.user.id, toStatus: 'OPEN', note: 'Complaint raised' }, { transaction: t });
      return c;
    });
    audit({ action: 'COMPLAINT_RAISED', actor: req.user, entity: 'complaint', entityId: complaint.id, requestId: req.id });
    const room = await Room.findByPk(complaint.roomId, { attributes: ['hostelId'] });
    const hostel = await room.getHostel?.();
    if (hostel?.wardenId) notify(hostel.wardenId, 'COMPLAINT', `New ${complaint.priority.toLowerCase()} priority complaint: ${complaint.title}`);
    res.status(201).location(`/api/v1/complaints/${complaint.id}`).json({ data: await loadView(complaint.id, req.user) });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/:id/status',
  requirePermission(['complaint:create', 'complaint:manage']),
  validate({ params: idParam, body: z.object({ status: z.enum(STATUSES), note: z.string().trim().max(500).optional() }) }),
  async (req, res, next) => {
    try {
      const to = req.body.status;
      const result = await sequelize.transaction(async (t) => {
        const c = await Complaint.findByPk(req.params.id, { lock: { level: t.LOCK.UPDATE, of: Complaint }, transaction: t, include: [{ model: Room, attributes: ['hostelId'], required: true }] });
        if (!c) throw notFound('Complaint');
        const role = req.user.studentId ? 'owner' : 'staff';
        if (role === 'owner' && c.studentId !== req.user.studentId) throw forbidden('This is not your complaint');
        if (role === 'staff') assertHostelScope(req.user, c.room.hostelId);
        const who = TRANSITIONS[c.status][to];
        if (!who) throw conflict(`Cannot move a complaint from ${c.status} to ${to}`, { allowedNext: Object.keys(TRANSITIONS[c.status]) });
        if (who !== role) throw forbidden(role === 'owner' ? 'Only hostel staff can make this change' : 'Only the student who raised it can make this change');
        const from = c.status;
        await c.update({ status: to, updatedAt: new Date(), resolvedAt: to === 'RESOLVED' ? new Date() : to === 'OPEN' ? null : c.resolvedAt }, { transaction: t });
        await ComplaintEvent.create({ complaintId: c.id, actorId: req.user.id, fromStatus: from, toStatus: to, note: req.body.note }, { transaction: t });
        return { c, from };
      });
      audit({ action: 'COMPLAINT_STATUS_CHANGED', actor: req.user, entity: 'complaint', entityId: result.c.id, data: { from: result.from, to }, requestId: req.id });
      if (!req.user.studentId) {
        const s = await Student.findByPk(result.c.studentId, { attributes: ['userId'] });
        notify(s.userId, 'COMPLAINT', `Your complaint "${result.c.title}" is now ${to.replace('_', ' ').toLowerCase()}.`);
      }
      res.json({ data: await loadView(result.c.id, req.user) });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
