const express = require('express');
const { z } = require('zod');
const { QueryTypes } = require('sequelize');
const sequelize = require('../../lib/db');
const { SwapRequest, Allocation, Student, ACTIVE_STATUSES } = require('../../models');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { conflict, notFound, forbidden, unprocessable } = require('../../lib/errors');
const { resolveSession } = require('../../services/rounds');
const { approveSwap } = require('../../services/allocation');
const { audit, notify } = require('../../services/audit');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });

const SWAP_SELECT = `
  SELECT sw.id, sw.status, sw.session, sw.created_at AS "createdAt", sw.decided_at AS "decidedAt",
         ra.id AS "requesterAllocId", rs.roll_no AS "requesterRollNo", ru.name AS "requesterName",
         rh.id AS "requesterHostelId", rh.name AS "requesterHostel", rr.room_no AS "requesterRoom", rb.label AS "requesterBed",
         ta.id AS "targetAllocId", ts.roll_no AS "targetRollNo", tu.name AS "targetName",
         th.id AS "targetHostelId", th.name AS "targetHostel", tr.room_no AS "targetRoom", tb.label AS "targetBed",
         rs.id AS "requesterStudentId", ts.id AS "targetStudentId"
    FROM swap_requests sw
    JOIN allocations ra ON ra.id = sw.requester_alloc_id
    JOIN students rs ON rs.id = ra.student_id JOIN users ru ON ru.id = rs.user_id
    JOIN beds rb ON rb.id = ra.bed_id JOIN rooms rr ON rr.id = rb.room_id JOIN hostels rh ON rh.id = rr.hostel_id
    JOIN allocations ta ON ta.id = sw.target_alloc_id
    JOIN students ts ON ts.id = ta.student_id JOIN users tu ON tu.id = ts.user_id
    JOIN beds tb ON tb.id = ta.bed_id JOIN rooms tr ON tr.id = tb.room_id JOIN hostels th ON th.id = tr.hostel_id`;

router.get(
  '/',
  requirePermission(['swap:create', 'swap:approve']),
  validate({ query: z.object({ status: z.enum(['PENDING_PEER', 'PENDING_WARDEN', 'APPROVED', 'REJECTED', 'CANCELLED']).optional() }) }),
  async (req, res, next) => {
    try {
      const where = [];
      const rep = { status: req.validatedQuery.status, sid: req.user.studentId, hid: req.user.hostelId };
      if (rep.status) where.push('sw.status = :status');
      if (req.user.studentId) where.push('(rs.id = :sid OR ts.id = :sid)');
      else if (!req.user.permissions.has('hostel:all')) where.push('(rh.id = :hid OR th.id = :hid)');
      const data = await sequelize.query(
        `${SWAP_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY sw.created_at DESC LIMIT 100`,
        { replacements: rep, type: QueryTypes.SELECT }
      );
      res.json({ data });
    } catch (err) {
      next(err);
    }
  }
);

// Student A proposes a swap with student B (by roll number).
router.post(
  '/',
  requirePermission('swap:create'),
  validate({ body: z.object({ targetRollNo: z.string().trim().min(3).max(20) }) }),
  async (req, res, next) => {
    try {
      const session = await resolveSession();
      const swap = await sequelize.transaction(async (t) => {
        const mine = await Allocation.findOne({ where: { studentId: req.user.studentId, session, status: ACTIVE_STATUSES }, transaction: t });
        if (!mine) throw conflict('You need an active allocation before requesting a swap');
        const target = await Student.findOne({ where: { rollNo: req.body.targetRollNo }, transaction: t });
        if (!target) throw notFound('Student with that roll number');
        if (target.id === req.user.studentId) throw unprocessable('You cannot swap with yourself');
        const theirs = await Allocation.findOne({ where: { studentId: target.id, session, status: ACTIVE_STATUSES }, transaction: t });
        if (!theirs) throw conflict('That student has no active allocation this session');

        const [pending] = await sequelize.query(
          `SELECT id FROM swap_requests
            WHERE status IN ('PENDING_PEER','PENDING_WARDEN')
              AND (requester_alloc_id IN (:ids) OR target_alloc_id IN (:ids)) LIMIT 1`,
          { replacements: { ids: [mine.id, theirs.id] }, type: QueryTypes.SELECT, transaction: t }
        );
        if (pending) throw conflict('One of you already has a pending swap request');
        return SwapRequest.create({ session, requesterAllocId: mine.id, targetAllocId: theirs.id }, { transaction: t });
      });
      audit({ action: 'SWAP_REQUESTED', actor: req.user, entity: 'swap_request', entityId: swap.id, session, requestId: req.id });
      const target = await Student.findOne({ where: { rollNo: req.body.targetRollNo }, attributes: ['userId'] });
      notify(target.userId, 'SWAP', 'You have a new room swap request.');
      res.status(201).json({ data: swap });
    } catch (err) {
      next(err);
    }
  }
);

async function loadSwapView(id) {
  const [row] = await sequelize.query(`${SWAP_SELECT} WHERE sw.id = :id`, { replacements: { id }, type: QueryTypes.SELECT });
  return row;
}

// Target student accepts or rejects.
router.patch(
  '/:id/respond',
  requirePermission('swap:create'),
  validate({ params: idParam, body: z.object({ accept: z.boolean() }) }),
  async (req, res, next) => {
    try {
      const swap = await sequelize.transaction(async (t) => {
        const s = await SwapRequest.findByPk(req.params.id, { lock: t.LOCK.UPDATE, transaction: t });
        if (!s) throw notFound('Swap request');
        const target = await Allocation.findByPk(s.targetAllocId, { transaction: t });
        if (target.studentId !== req.user.studentId) throw forbidden('Only the other student can respond to this swap');
        if (s.status !== 'PENDING_PEER') throw conflict(`Swap is already ${s.status}`);
        return s.update({ status: req.body.accept ? 'PENDING_WARDEN' : 'REJECTED', decidedAt: req.body.accept ? null : new Date() }, { transaction: t });
      });
      audit({ action: req.body.accept ? 'SWAP_ACCEPTED' : 'SWAP_DECLINED', actor: req.user, entity: 'swap_request', entityId: swap.id, requestId: req.id });
      res.json({ data: await loadSwapView(swap.id) });
    } catch (err) {
      next(err);
    }
  }
);

// Requester withdraws.
router.patch('/:id/cancel', requirePermission('swap:create'), validate({ params: idParam }), async (req, res, next) => {
  try {
    const swap = await sequelize.transaction(async (t) => {
      const s = await SwapRequest.findByPk(req.params.id, { lock: t.LOCK.UPDATE, transaction: t });
      if (!s) throw notFound('Swap request');
      const mine = await Allocation.findByPk(s.requesterAllocId, { transaction: t });
      if (mine.studentId !== req.user.studentId) throw forbidden('Only the requester can cancel this swap');
      if (!['PENDING_PEER', 'PENDING_WARDEN'].includes(s.status)) throw conflict(`Swap is already ${s.status}`);
      return s.update({ status: 'CANCELLED', decidedAt: new Date() }, { transaction: t });
    });
    res.json({ data: swap });
  } catch (err) {
    next(err);
  }
});

// Warden (of BOTH hostels) or admin approves / rejects.
router.patch(
  '/:id/decision',
  requirePermission('swap:approve'),
  validate({ params: idParam, body: z.object({ approve: z.boolean() }) }),
  async (req, res, next) => {
    try {
      if (req.body.approve) {
        const result = await approveSwap({ swapId: req.params.id, user: req.user });
        audit({
          action: 'SWAP_APPROVED', actor: req.user, entity: 'swap_request', entityId: result.swap.id, session: result.swap.session,
          data: {
            moves: [
              { rollNo: result.studentA.rollNo, newAllocationId: result.newAllocations[0].id, bedId: result.newAllocations[0].bedId },
              { rollNo: result.studentB.rollNo, newAllocationId: result.newAllocations[1].id, bedId: result.newAllocations[1].bedId },
            ],
          },
          requestId: req.id,
        });
        [result.studentA, result.studentB].forEach((s) => notify(s.userId, 'SWAP', 'Your room swap was approved.'));
        return res.json({ data: await loadSwapView(result.swap.id) });
      }
      const view = await loadSwapView(req.params.id);
      if (!view) throw notFound('Swap request');
      if (!req.user.permissions.has('hostel:all') && view.requesterHostelId !== req.user.hostelId && view.targetHostelId !== req.user.hostelId) {
        throw forbidden('You can only manage your own hostel');
      }
      const [count] = await SwapRequest.update(
        { status: 'REJECTED', decidedAt: new Date() },
        { where: { id: req.params.id, status: 'PENDING_WARDEN' } }
      );
      if (!count) throw conflict(`Swap is ${view.status}, not awaiting approval`);
      audit({ action: 'SWAP_REJECTED', actor: req.user, entity: 'swap_request', entityId: Number(req.params.id), requestId: req.id });
      return res.json({ data: await loadSwapView(req.params.id) });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
