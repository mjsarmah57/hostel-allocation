const express = require('express');
const { z } = require('zod');
const { QueryTypes } = require('sequelize');
const sequelize = require('../../lib/db');
const { Hostel, Student, Room, Bed, User, Role, ACTIVE_STATUSES } = require('../../models');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { parseListQuery, pageMeta } = require('../../lib/pagination');
const { resolveSession } = require('../../services/rounds');
const { notFound, conflict, unprocessable } = require('../../lib/errors');
const { audit } = require('../../services/audit');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });

router.get(
  '/',
  requirePermission('hostel:read'),
  validate({ query: z.object({ session: z.string().regex(/^\d{4}-\d{2}$/).optional(), eligible: z.enum(['true', 'false']).optional() }) }),
  async (req, res, next) => {
    try {
      const session = await resolveSession(req.validatedQuery.session);
      const rows = await sequelize.query(
        `SELECT h.id, h.name, h.code, h.gender, h.allowed_years AS "allowedYears",
                u.name AS "wardenName",
                COUNT(DISTINCT r.id)::int AS rooms,
                COUNT(b.id)::int AS beds,
                COUNT(a.id)::int AS occupied
           FROM hostels h
           LEFT JOIN users u ON u.id = h.warden_id
           LEFT JOIN rooms r ON r.hostel_id = h.id
           LEFT JOIN beds b ON b.room_id = r.id
           LEFT JOIN allocations a ON a.bed_id = b.id AND a.session = :session AND a.status IN (:active)
          GROUP BY h.id, u.name
          ORDER BY h.name`,
        { replacements: { session, active: ACTIVE_STATUSES }, type: QueryTypes.SELECT }
      );

      let data = rows.map((r) => ({ ...r, freeBeds: r.beds - r.occupied }));
      if (req.validatedQuery.eligible === 'true' && req.user.studentId) {
        const s = await Student.findByPk(req.user.studentId);
        data = data.filter((h) => h.gender === s.gender && h.allowedYears.includes(s.year));
      }
      res.json({ session, data });
    } catch (err) {
      next(err);
    }
  }
);

const roomQuery = z.object({
  session: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  floor: z.coerce.number().int().min(0).max(20).optional(),
  available: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.string().optional(),
});
const ROOM_SORT = { roomNo: 'r.room_no', floor: 'r.floor', freeBeds: 'free_beds', capacity: 'r.capacity' };

router.get(
  '/:id/rooms',
  requirePermission('hostel:read'),
  validate({ params: idParam, query: roomQuery }),
  async (req, res, next) => {
    try {
      const hostel = await Hostel.findByPk(req.params.id);
      if (!hostel) throw notFound('Hostel');
      const q = req.validatedQuery;
      const session = await resolveSession(q.session);
      const list = parseListQuery(q, ROOM_SORT, 'roomNo');

      const rows = await sequelize.query(
        `SELECT r.id, r.room_no AS "roomNo", r.floor, r.capacity,
                (r.capacity - COUNT(a.id))::int AS free_beds,
                COUNT(*) OVER()::int AS total_count
           FROM rooms r
           JOIN beds b ON b.room_id = r.id
           LEFT JOIN allocations a ON a.bed_id = b.id AND a.session = :session AND a.status IN (:active)
          WHERE r.hostel_id = :hostelId ${q.floor !== undefined ? 'AND r.floor = :floor' : ''}
          GROUP BY r.id
          ${q.available === 'true' ? 'HAVING r.capacity - COUNT(a.id) > 0' : ''}
          ORDER BY ${list.orderSql}, r.id
          LIMIT :limit OFFSET :offset`,
        {
          replacements: { session, active: ACTIVE_STATUSES, hostelId: hostel.id, floor: q.floor, limit: list.limit, offset: list.offset },
          type: QueryTypes.SELECT,
        }
      );
      const total = rows[0]?.total_count ?? 0;
      res.json({
        session,
        hostel: { id: hostel.id, name: hostel.name, gender: hostel.gender, allowedYears: hostel.allowedYears },
        data: rows.map(({ total_count, free_beds, ...r }) => ({ ...r, freeBeds: free_beds })),
        meta: pageMeta(list, total),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- Hostel detail: summary, warden, floor-by-floor room map ----------
router.get('/:id', requirePermission('hostel:read'), validate({ params: idParam, query: z.object({ session: z.string().regex(/^\d{4}-\d{2}$/).optional() }) }), async (req, res, next) => {
  try {
    const hostel = await Hostel.findByPk(req.params.id, { include: [{ model: User, as: 'warden', attributes: ['id', 'name', 'email', 'phone'] }] });
    if (!hostel) throw notFound('Hostel');
    const session = await resolveSession(req.validatedQuery.session);
    const rooms = await sequelize.query(
      `SELECT r.id, r.room_no AS "roomNo", r.floor, r.capacity,
              COUNT(a.id)::int AS occupied,
              (SELECT COUNT(*) FROM complaints c WHERE c.room_id = r.id AND c.status IN ('OPEN','IN_PROGRESS'))::int AS "openComplaints"
         FROM rooms r JOIN beds b ON b.room_id = r.id
         LEFT JOIN allocations a ON a.bed_id = b.id AND a.session = :session AND a.status IN (:active)
        WHERE r.hostel_id = :id GROUP BY r.id ORDER BY r.floor, r.room_no`,
      { replacements: { id: hostel.id, session, active: ACTIVE_STATUSES }, type: QueryTypes.SELECT }
    );
    const [stats] = await sequelize.query(
      `SELECT COUNT(a.id) FILTER (WHERE a.status = 'ALLOCATED')::int AS "awaitingFee",
              COUNT(a.id) FILTER (WHERE a.status = 'FEE_SUBMITTED')::int AS "feeSubmitted",
              COUNT(a.id) FILTER (WHERE a.status = 'VERIFIED')::int AS verified,
              COUNT(a.id) FILTER (WHERE a.status = 'CHECKED_IN')::int AS "checkedIn"
         FROM allocations a JOIN beds b ON b.id = a.bed_id JOIN rooms r ON r.id = b.room_id
        WHERE r.hostel_id = :id AND a.session = :session`,
      { replacements: { id: hostel.id, session }, type: QueryTypes.SELECT }
    );
    const floors = {};
    for (const r of rooms) (floors[r.floor] ||= []).push(r);
    const beds = rooms.reduce((n, r) => n + r.capacity, 0);
    const occupied = rooms.reduce((n, r) => n + r.occupied, 0);
    res.json({
      session,
      data: {
        id: hostel.id, name: hostel.name, code: hostel.code, gender: hostel.gender, allowedYears: hostel.allowedYears,
        warden: hostel.warden, totals: { rooms: rooms.length, beds, occupied, free: beds - occupied, ...stats },
        openComplaints: rooms.reduce((n, r) => n + r.openComplaints, 0),
        floors: Object.entries(floors).map(([floor, list]) => ({ floor: Number(floor), rooms: list })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------- Create / edit hostels (admin) ----------
const hostelSchema = z.object({
  name: z.string().trim().min(3).max(80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,10}$/, 'Code: 2–10 letters'),
  gender: z.enum(['MALE', 'FEMALE']),
  allowedYears: z.array(z.number().int().min(1).max(5)).min(1, 'Pick at least one year').refine((a) => new Set(a).size === a.length, 'Years must not repeat'),
  wardenId: z.number().int().positive().nullable().optional(),
});

async function assertWarden(wardenId, t) {
  if (!wardenId) return;
  const u = await User.findByPk(wardenId, { include: [Role], transaction: t });
  if (!u || u.role.name !== 'warden') throw unprocessable('wardenId must belong to a warden account');
}

router.post('/', requirePermission('hostel:manage'), validate({ body: hostelSchema }), async (req, res, next) => {
  try {
    const hostel = await sequelize.transaction(async (t) => {
      await assertWarden(req.body.wardenId, t);
      if (req.body.wardenId) await Hostel.update({ wardenId: null }, { where: { wardenId: req.body.wardenId }, transaction: t });
      return Hostel.create({ ...req.body, allowedYears: [...req.body.allowedYears].sort() }, { transaction: t });
    });
    audit({ action: 'HOSTEL_CREATED', actor: req.user, entity: 'hostel', entityId: hostel.id, requestId: req.id });
    res.status(201).location(`/api/v1/hostels/${hostel.id}`).json({ data: hostel });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requirePermission('hostel:manage'), validate({ params: idParam, body: hostelSchema.partial().omit({ gender: true }) }), async (req, res, next) => {
  try {
    const hostel = await sequelize.transaction(async (t) => {
      const h = await Hostel.findByPk(req.params.id, { lock: t.LOCK.UPDATE, transaction: t });
      if (!h) throw notFound('Hostel');
      await assertWarden(req.body.wardenId, t);
      if (req.body.wardenId) await Hostel.update({ wardenId: null }, { where: { wardenId: req.body.wardenId }, transaction: t });
      return h.update(req.body, { transaction: t });
    });
    audit({ action: 'HOSTEL_UPDATED', actor: req.user, entity: 'hostel', entityId: hostel.id, data: req.body, requestId: req.id });
    res.json({ data: hostel });
  } catch (err) {
    next(err);
  }
});

// ---------- Add rooms: one room, or a whole range on a floor (admin) ----------
const addRoomsSchema = z.object({
  floor: z.number().int().min(0).max(20),
  from: z.number().int().min(1).max(99),
  to: z.number().int().min(1).max(99),
  capacity: z.number().int().min(1).max(6),
}).refine((v) => v.to >= v.from, { message: '"to" must be ≥ "from"', path: ['to'] }).refine((v) => v.to - v.from < 60, { message: 'At most 60 rooms at a time', path: ['to'] });

router.post('/:id/rooms', requirePermission('hostel:manage'), validate({ params: idParam, body: addRoomsSchema }), async (req, res, next) => {
  try {
    const { floor, from, to, capacity } = req.body;
    const created = await sequelize.transaction(async (t) => {
      const h = await Hostel.findByPk(req.params.id, { transaction: t });
      if (!h) throw notFound('Hostel');
      const numbers = Array.from({ length: to - from + 1 }, (_, k) => `${floor}${String(from + k).padStart(2, '0')}`);
      const clash = await Room.findAll({ where: { hostelId: h.id, roomNo: numbers }, attributes: ['roomNo'], transaction: t });
      if (clash.length) throw conflict(`Room(s) already exist: ${clash.map((r) => r.roomNo).join(', ')}`);
      const rooms = await Room.bulkCreate(numbers.map((roomNo) => ({ hostelId: h.id, roomNo, floor, capacity })), { transaction: t, returning: true });
      await Bed.bulkCreate(rooms.flatMap((r) => Array.from({ length: capacity }, (_, k) => ({ roomId: r.id, label: 'ABCDEF'[k] }))), { transaction: t });
      return rooms;
    });
    audit({ action: 'ROOMS_ADDED', actor: req.user, entity: 'hostel', entityId: req.params.id, data: req.body, requestId: req.id });
    res.status(201).json({ data: { created: created.length, rooms: created.map((r) => ({ id: r.id, roomNo: r.roomNo })) } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
