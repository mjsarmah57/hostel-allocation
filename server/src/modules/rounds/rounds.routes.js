const express = require('express');
const { z } = require('zod');
const sequelize = require('../../lib/db');
const { AllocationRound, Preference, Room, Hostel, Student } = require('../../models');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { conflict, notFound, unprocessable } = require('../../lib/errors');
const { runPriorityAllocation, bookBed } = require('../../services/allocation');
const { getCurrentRound } = require('../../services/rounds');
const { isEligible } = require('../../services/eligibility');
const { audit, notify } = require('../../services/audit');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });

// Round lifecycle (manual transitions). PREFERENCES_OPEN -> ALLOCATED happens only via POST /run.
const ROUND_TRANSITIONS = {
  DRAFT: ['PREFERENCES_OPEN'],
  PREFERENCES_OPEN: [],
  ALLOCATED: ['BOOKING_OPEN', 'CLOSED'],
  BOOKING_OPEN: ['CLOSED'],
  CLOSED: [],
};

router.get('/', requirePermission('round:read'), async (req, res, next) => {
  try {
    const data = await AllocationRound.findAll({ order: [['createdAt', 'DESC']] });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.get('/current', requirePermission('round:read'), async (req, res, next) => {
  try {
    const round = await getCurrentRound();
    if (!round) throw notFound('Allocation round');
    res.json({ data: round });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  session: z.string().regex(/^\d{4}-\d{2}$/, 'Session must look like 2026-27'),
  name: z.string().trim().min(3).max(80),
  feeWindowDays: z.number().int().min(1).max(60).default(7),
});

router.post('/', requirePermission('round:manage'), validate({ body: createSchema }), async (req, res, next) => {
  try {
    const active = await getCurrentRound();
    if (active && active.status !== 'CLOSED') {
      throw conflict(`Round for ${active.session} is still ${active.status}; close it first`);
    }
    const round = await AllocationRound.create(req.body);
    audit({ action: 'ROUND_CREATED', actor: req.user, entity: 'round', entityId: round.id, session: round.session, requestId: req.id });
    res.status(201).location(`/api/v1/rounds/${round.id}`).json({ data: round });
  } catch (err) {
    next(err);
  }
});

const statusSchema = z.object({ status: z.enum(['PREFERENCES_OPEN', 'BOOKING_OPEN', 'CLOSED']) });

router.patch(
  '/:id/status',
  requirePermission('round:manage'),
  validate({ params: idParam, body: statusSchema }),
  async (req, res, next) => {
    try {
      const round = await sequelize.transaction(async (t) => {
        const r = await AllocationRound.findByPk(req.params.id, { lock: t.LOCK.UPDATE, transaction: t });
        if (!r) throw notFound('Allocation round');
        const allowed = ROUND_TRANSITIONS[r.status];
        if (!allowed.includes(req.body.status)) {
          throw conflict(`Cannot move round from ${r.status} to ${req.body.status}`, { allowedNext: allowed });
        }
        return r.update({ status: req.body.status }, { transaction: t });
      });
      audit({ action: 'ROUND_STATUS_CHANGED', actor: req.user, entity: 'round', entityId: round.id, session: round.session, data: { to: round.status }, requestId: req.id });
      res.json({ data: round });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- Preferences (student) ----------
router.get('/:id/preferences/me', requirePermission('preference:submit'), validate({ params: idParam }), async (req, res, next) => {
  try {
    const data = await Preference.findAll({
      where: { roundId: req.params.id, studentId: req.user.studentId },
      include: [{ model: Room, attributes: ['id', 'roomNo', 'floor', 'capacity'], include: [{ model: Hostel, attributes: ['id', 'name', 'code'] }] }],
      order: [['rank', 'ASC']],
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

const prefSchema = z.object({
  roomIds: z.array(z.number().int().positive()).min(1, 'Pick at least one room').max(5, 'At most 5 preferences')
    .refine((ids) => new Set(ids).size === ids.length, 'Rooms must not repeat'),
});

// PUT = full replacement of the ranked list (rank = array position + 1).
router.put(
  '/:id/preferences',
  requirePermission('preference:submit'),
  validate({ params: idParam, body: prefSchema }),
  async (req, res, next) => {
    try {
      const { roomIds } = req.body;
      const data = await sequelize.transaction(async (t) => {
        const round = await AllocationRound.findByPk(req.params.id, { lock: t.LOCK.SHARE, transaction: t });
        if (!round) throw notFound('Allocation round');
        if (round.status !== 'PREFERENCES_OPEN') throw conflict('Preferences are not open for this round');

        const student = await Student.findByPk(req.user.studentId, { transaction: t });
        const rooms = await Room.findAll({ where: { id: roomIds }, include: [Hostel], transaction: t });
        if (rooms.length !== roomIds.length) throw unprocessable('One or more rooms do not exist');
        const bad = rooms.filter((r) => !isEligible(student, r.hostel));
        if (bad.length) {
          throw unprocessable('You are not eligible for some of the chosen rooms', bad.map((r) => ({ roomId: r.id, hostel: r.hostel.name })));
        }

        await Preference.destroy({ where: { roundId: round.id, studentId: student.id }, transaction: t });
        return Preference.bulkCreate(
          roomIds.map((roomId, i) => ({ roundId: round.id, studentId: student.id, roomId, rank: i + 1 })),
          { transaction: t }
        );
      });
      audit({ action: 'PREFERENCES_SUBMITTED', actor: req.user, entity: 'round', entityId: Number(req.params.id), data: { roomIds }, requestId: req.id });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

// ---------- Round 1: run the priority allocation (admin) ----------
router.post('/:id/run', requirePermission('allocation:run'), validate({ params: idParam }), async (req, res, next) => {
  try {
    const summary = await runPriorityAllocation(req.params.id);
    audit({
      action: 'PRIORITY_ALLOCATION_RUN', actor: req.user, entity: 'round', entityId: summary.round.id,
      session: summary.round.session, data: { allocated: summary.allocated, unallocated: summary.unallocated }, requestId: req.id,
    });
    // Fire-and-forget notifications to allocated students.
    if (summary.allocations.length) {
      Student.findAll({ where: { id: summary.allocations.map((a) => a.studentId) }, attributes: ['userId'] })
        .then((ss) => ss.forEach((s) => notify(s.userId, 'ALLOCATED', 'You have been allocated a bed. Upload your fee receipt before the deadline.')))
        .catch(() => {});
    }
    const { allocations, ...rest } = summary;
    res.json({ data: rest });
  } catch (err) {
    next(err);
  }
});

// ---------- Round 2: open booking (student) ----------
router.post(
  '/:id/book',
  requirePermission('booking:create'),
  validate({ params: idParam, body: z.object({ roomId: z.number().int().positive() }) }),
  async (req, res, next) => {
    try {
      const { allocation, hostel, room, bedLabel } = await bookBed({
        roundId: req.params.id, studentId: req.user.studentId, roomId: req.body.roomId,
      });
      audit({
        action: 'BED_BOOKED', actor: req.user, entity: 'allocation', entityId: allocation.id,
        session: allocation.session, data: { roomId: room.id, bedId: allocation.bedId }, requestId: req.id,
      });
      notify(req.user.id, 'BOOKED', `Bed ${bedLabel} in ${hostel.name} room ${room.roomNo} is yours. Upload your fee receipt.`);
      res.status(201).location(`/api/v1/allocations/${allocation.id}`).json({
        data: { ...allocation.toJSON(), hostel: hostel.name, roomNo: room.roomNo, bedLabel },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
