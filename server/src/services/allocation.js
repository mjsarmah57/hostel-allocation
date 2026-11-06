// =====================================================================
// Allocation service: every operation here that changes who sleeps in
// which bed runs inside a single database transaction.
// =====================================================================
const { QueryTypes, UniqueConstraintError } = require('sequelize');
const sequelize = require('../lib/db');
const {
  ACTIVE_STATUSES, AllocationRound, Allocation, Student, Room, Hostel, Bed, FeeReceipt, SwapRequest,
} = require('../models');
const { conflict, notFound, forbidden, unprocessable } = require('../lib/errors');
const { assertHostelScope } = require('../middleware/authorize');
const { isEligible } = require('./eligibility');

const addDays = (d) => new Date(Date.now() + d * 24 * 3600 * 1000);

// ---------------------------------------------------------------------
// Allocation lifecycle as DATA, not if-statements.
//   key = current status, value = { nextStatus: permissionRequired }
// ---------------------------------------------------------------------
const TRANSITIONS = {
  ALLOCATED: { FEE_SUBMITTED: 'receipt:upload', RELEASED: 'allocation:release' },
  FEE_SUBMITTED: { VERIFIED: 'receipt:verify', ALLOCATED: 'receipt:verify' }, // ALLOCATED = receipt rejected
  VERIFIED: { CHECKED_IN: 'allocation:update' },
  CHECKED_IN: { VACATED: 'allocation:update' },
  VACATED: {},
  RELEASED: {},
  SWAPPED: {},
};

// ---------------------------------------------------------------------
// Round 1 — priority allocation (batch algorithm)
// ---------------------------------------------------------------------
async function runPriorityAllocation(roundId) {
  return sequelize.transaction(async (t) => {
    // Row lock on the round: a second "Run" click waits here, then sees ALLOCATED and gets 409.
    const round = await AllocationRound.findByPk(roundId, { lock: t.LOCK.UPDATE, transaction: t });
    if (!round) throw notFound('Allocation round');
    if (round.status !== 'PREFERENCES_OPEN') {
      throw conflict(`Allocation can only run while preferences are open (current status: ${round.status})`);
    }

    // Priority order: PwD first, then seniority, then CGPA (served by idx_students_priority).
    const students = await sequelize.query(
      `SELECT s.id, s.gender, s.year
         FROM students s
        WHERE EXISTS (SELECT 1 FROM preferences p WHERE p.round_id = :roundId AND p.student_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM allocations a
                           WHERE a.student_id = s.id AND a.session = :session AND a.status IN (:active))
        ORDER BY s.is_pwd DESC, s.year DESC, s.cgpa DESC, s.id`,
      { replacements: { roundId, session: round.session, active: ACTIVE_STATUSES }, type: QueryTypes.SELECT, transaction: t }
    );

    const prefs = await sequelize.query(
      `SELECT p.student_id AS "studentId", p.room_id AS "roomId", p.rank, r.hostel_id AS "hostelId"
         FROM preferences p JOIN rooms r ON r.id = p.room_id
        WHERE p.round_id = :roundId ORDER BY p.student_id, p.rank`,
      { replacements: { roundId }, type: QueryTypes.SELECT, transaction: t }
    );
    const prefsByStudent = new Map();
    for (const p of prefs) {
      if (!prefsByStudent.has(p.studentId)) prefsByStudent.set(p.studentId, []);
      prefsByStudent.get(p.studentId).push(p);
    }

    // Free beds in every hostel that appears in someone's preferences, locked so
    // nothing else can claim them while we allocate.
    const freeBeds = await sequelize.query(
      `SELECT b.id, b.room_id AS "roomId", r.hostel_id AS "hostelId"
         FROM beds b JOIN rooms r ON r.id = b.room_id
        WHERE r.hostel_id IN (SELECT DISTINCT r2.hostel_id FROM preferences p JOIN rooms r2 ON r2.id = p.room_id WHERE p.round_id = :roundId)
          AND NOT EXISTS (SELECT 1 FROM allocations a
                           WHERE a.bed_id = b.id AND a.session = :session AND a.status IN (:active))
        ORDER BY r.hostel_id, r.floor, r.room_no, b.label
        FOR UPDATE OF b`,
      { replacements: { roundId, session: round.session, active: ACTIVE_STATUSES }, type: QueryTypes.SELECT, transaction: t }
    );
    const byRoom = new Map();
    const byHostel = new Map();
    for (const b of freeBeds) {
      if (!byRoom.has(b.roomId)) byRoom.set(b.roomId, []);
      byRoom.get(b.roomId).push(b.id);
      if (!byHostel.has(b.hostelId)) byHostel.set(b.hostelId, []);
      byHostel.get(b.hostelId).push(b.id);
    }
    const taken = new Set();
    const takeFrom = (list) => {
      while (list && list.length) {
        const id = list.shift();
        if (!taken.has(id)) { taken.add(id); return id; }
      }
      return null;
    };

    const feeDueAt = addDays(round.feeWindowDays);
    const rows = [];
    const byRank = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, hostelFallback: 0 };
    for (const s of students) {
      const mine = prefsByStudent.get(s.id) || [];
      let bedId = null;
      for (const p of mine) {
        bedId = takeFrom(byRoom.get(p.roomId));
        if (bedId) { byRank[p.rank] += 1; break; }
      }
      // Rule: if every chosen room is full, take any free bed in the hostel of the first choice.
      if (!bedId && mine.length) {
        bedId = takeFrom(byHostel.get(mine[0].hostelId));
        if (bedId) byRank.hostelFallback += 1;
      }
      if (bedId) {
        rows.push({ session: round.session, studentId: s.id, bedId, roundId: round.id, status: 'ALLOCATED', source: 'PRIORITY', feeDueAt });
      }
    }

    if (rows.length) await Allocation.bulkCreate(rows, { transaction: t });
    await round.update({ status: 'ALLOCATED', allocatedAt: new Date() }, { transaction: t });

    return {
      round: { id: round.id, session: round.session, status: 'ALLOCATED' },
      studentsWithPreferences: students.length,
      allocated: rows.length,
      unallocated: students.length - rows.length,
      allocatedByPreferenceRank: byRank,
      allocations: rows.map((r) => ({ studentId: r.studentId, bedId: r.bedId })),
    };
  });
}

// ---------------------------------------------------------------------
// Round 2 — open booking: THE concurrency-critical operation.
// 50 students hitting the last bed => exactly one 201, forty-nine 409.
// ---------------------------------------------------------------------
async function bookBed({ roundId, studentId, roomId }) {
  try {
    return await sequelize.transaction(async (t) => {
      // FOR SHARE: many bookings proceed together, but an admin closing the round
      // (FOR UPDATE) waits until in-flight bookings finish.
      const round = await AllocationRound.findByPk(roundId, { lock: t.LOCK.SHARE, transaction: t });
      if (!round) throw notFound('Allocation round');
      if (round.status !== 'BOOKING_OPEN') throw conflict('Open booking is not active for this round');

      const [student, room] = await Promise.all([
        Student.findByPk(studentId, { transaction: t }),
        Room.findByPk(roomId, { include: [Hostel], transaction: t }),
      ]);
      if (!student) throw notFound('Student');
      if (!room) throw notFound('Room');
      if (!isEligible(student, room.hostel)) {
        throw unprocessable(`You are not eligible for ${room.hostel.name}`);
      }

      const existing = await Allocation.findOne({
        where: { studentId, session: round.session, status: ACTIVE_STATUSES },
        transaction: t,
      });
      if (existing) throw conflict('You already hold a bed for this session');

      // Pick one free bed in the room and lock it. SKIP LOCKED means a concurrent
      // transaction that already locked bed A moves on to bed B instead of waiting.
      const [bed] = await sequelize.query(
        `SELECT b.id, b.label
           FROM beds b
          WHERE b.room_id = :roomId
            AND NOT EXISTS (SELECT 1 FROM allocations a
                             WHERE a.bed_id = b.id AND a.session = :session AND a.status IN (:active))
          ORDER BY b.label
          LIMIT 1
          FOR UPDATE OF b SKIP LOCKED`,
        { replacements: { roomId, session: round.session, active: ACTIVE_STATUSES }, type: QueryTypes.SELECT, transaction: t }
      );
      if (!bed) throw conflict(`No free bed left in room ${room.roomNo}`);

      const allocation = await Allocation.create(
        {
          session: round.session, studentId, bedId: bed.id, roundId: round.id,
          status: 'ALLOCATED', source: 'OPEN_BOOKING', feeDueAt: addDays(round.feeWindowDays),
        },
        { transaction: t }
      );
      return { allocation, hostel: room.hostel, room, bedLabel: bed.label };
    });
  } catch (err) {
    // Second line of defence: the partial UNIQUE indexes.
    if (err instanceof UniqueConstraintError) {
      const c = err.parent?.constraint;
      if (c === 'uq_alloc_active_student') throw conflict('You already hold a bed for this session');
      throw conflict('That bed was just taken, please try another room');
    }
    throw err;
  }
}

// Loads an allocation with its bed -> room -> hostel chain (for scope checks).
function loadAllocation(id, t, lock) {
  return Allocation.findByPk(id, {
    include: [{ model: Bed, include: [{ model: Room, include: [Hostel] }] }],
    transaction: t,
    ...(lock ? { lock: { level: t.LOCK.UPDATE, of: Allocation } } : {}),
  });
}

// ---------------------------------------------------------------------
// Generic state transition (warden/admin actions)
// ---------------------------------------------------------------------
async function transitionAllocation({ allocationId, to, user, note }) {
  return sequelize.transaction(async (t) => {
    const a = await loadAllocation(allocationId, t, true);
    if (!a) throw notFound('Allocation');
    assertHostelScope(user, a.bed.room.hostel.id);

    const allowed = TRANSITIONS[a.status] || {};
    if (!(to in allowed)) {
      throw conflict(`Cannot move an allocation from ${a.status} to ${to}`, {
        from: a.status, to, allowedNext: Object.keys(allowed),
      });
    }
    if (to === 'FEE_SUBMITTED') throw conflict('FEE_SUBMITTED is set by uploading a receipt');
    if (!user.permissions.has(allowed[to])) throw forbidden();

    const from = a.status;
    if (to === 'VERIFIED' || (from === 'FEE_SUBMITTED' && to === 'ALLOCATED')) {
      const receipt = await FeeReceipt.findOne({
        where: { allocationId: a.id, verifiedAt: null }, order: [['uploadedAt', 'DESC']], transaction: t,
      });
      if (receipt && to === 'VERIFIED') {
        await receipt.update({ verifiedBy: user.id, verifiedAt: new Date() }, { transaction: t });
      }
    }
    const patch = { status: to, updatedAt: new Date() };
    if (from === 'FEE_SUBMITTED' && to === 'ALLOCATED') patch.feeDueAt = addDays(3); // grace period to re-upload
    await a.update(patch, { transaction: t });
    return { allocation: a, from, to, note };
  });
}

// ---------------------------------------------------------------------
// Fee receipt upload (student) — moves ALLOCATED -> FEE_SUBMITTED
// ---------------------------------------------------------------------
async function submitReceipt({ allocationId, studentId, file }) {
  return sequelize.transaction(async (t) => {
    const a = await loadAllocation(allocationId, t, true);
    if (!a) throw notFound('Allocation');
    if (a.studentId !== studentId) throw forbidden('This is not your allocation');
    if (a.status !== 'ALLOCATED') {
      throw conflict(`A receipt can only be uploaded while the allocation is ALLOCATED (current: ${a.status})`);
    }
    const receipt = await FeeReceipt.create(
      { allocationId: a.id, filePath: file.filename, originalName: file.originalname.slice(0, 255), mimeType: file.mimetype, sizeBytes: file.size },
      { transaction: t }
    );
    await a.update({ status: 'FEE_SUBMITTED', updatedAt: new Date() }, { transaction: t });
    return { allocation: a, receipt };
  });
}

// ---------------------------------------------------------------------
// Room swap — both moves happen in ONE transaction, or neither does.
// ---------------------------------------------------------------------
async function approveSwap({ swapId, user }) {
  return sequelize.transaction(async (t) => {
    const swap = await SwapRequest.findByPk(swapId, { lock: t.LOCK.UPDATE, transaction: t });
    if (!swap) throw notFound('Swap request');
    if (swap.status !== 'PENDING_WARDEN') throw conflict(`Swap is ${swap.status}, not awaiting approval`);

    // Deadlock avoidance: always lock the two allocations in ascending id order.
    // Two wardens approving overlapping swaps in opposite order would otherwise deadlock.
    const ids = [swap.requesterAllocId, swap.targetAllocId].sort((x, y) => x - y);
    await sequelize.query(
      'SELECT id FROM allocations WHERE id IN (:ids) ORDER BY id FOR UPDATE',
      { replacements: { ids }, type: QueryTypes.SELECT, transaction: t }
    );
    const [a, b] = await Promise.all([
      loadAllocation(swap.requesterAllocId, t),
      loadAllocation(swap.targetAllocId, t),
    ]);

    // Contextual authorisation: the approver must manage BOTH hostels involved.
    assertHostelScope(user, a.bed.room.hostel.id);
    assertHostelScope(user, b.bed.room.hostel.id);

    if (!ACTIVE_STATUSES.includes(a.status) || !ACTIVE_STATUSES.includes(b.status)) {
      throw conflict('One of the allocations is no longer active; swap cannot proceed');
    }
    const [sa, sb] = await Promise.all([
      Student.findByPk(a.studentId, { transaction: t }),
      Student.findByPk(b.studentId, { transaction: t }),
    ]);
    if (!isEligible(sa, b.bed.room.hostel) || !isEligible(sb, a.bed.room.hostel)) {
      throw unprocessable('Swap would place a student in a hostel they are not eligible for');
    }

    // History is preserved: old rows become SWAPPED, two new rows take their place.
    await Allocation.update(
      { status: 'SWAPPED', updatedAt: new Date() },
      { where: { id: [a.id, b.id] }, transaction: t }
    );
    const [na, nb] = await Allocation.bulkCreate(
      [
        { session: a.session, studentId: a.studentId, bedId: b.bedId, roundId: a.roundId, status: a.status, source: 'SWAP', feeDueAt: a.feeDueAt },
        { session: b.session, studentId: b.studentId, bedId: a.bedId, roundId: b.roundId, status: b.status, source: 'SWAP', feeDueAt: b.feeDueAt },
      ],
      { transaction: t, returning: true }
    );
    // Receipts follow the student, not the bed.
    await FeeReceipt.update({ allocationId: na.id }, { where: { allocationId: a.id }, transaction: t });
    await FeeReceipt.update({ allocationId: nb.id }, { where: { allocationId: b.id }, transaction: t });

    await swap.update({ status: 'APPROVED', decidedAt: new Date() }, { transaction: t });
    // Any other pending swap touching these allocations is now meaningless.
    await sequelize.query(
      `UPDATE swap_requests SET status = 'CANCELLED', decided_at = now()
        WHERE id <> :id AND status IN ('PENDING_PEER','PENDING_WARDEN')
          AND (requester_alloc_id IN (:ids) OR target_alloc_id IN (:ids))`,
      { replacements: { id: swap.id, ids }, transaction: t }
    );

    return { swap, studentA: sa, studentB: sb, newAllocations: [na, nb], beds: { [sa.rollNo]: b.bed, [sb.rollNo]: a.bed } };
  });
}

// ---------------------------------------------------------------------
// Scheduled job: release allocations whose fee deadline passed.
// One atomic UPDATE ... RETURNING: no read-then-write race.
// ---------------------------------------------------------------------
async function releaseUnpaid() {
  const [rows] = await sequelize.query(
    `UPDATE allocations SET status = 'RELEASED', updated_at = now()
      WHERE status = 'ALLOCATED' AND fee_due_at < now()
      RETURNING id, student_id AS "studentId", session`
  );
  return rows;
}

module.exports = { TRANSITIONS, runPriorityAllocation, bookBed, transitionAllocation, submitReceipt, approveSwap, releaseUnpaid };
