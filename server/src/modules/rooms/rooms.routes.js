const express = require('express');
const { z } = require('zod');
const { QueryTypes } = require('sequelize');
const sequelize = require('../../lib/db');
const { Room, Bed, Hostel, ACTIVE_STATUSES } = require('../../models');
const validate = require('../../middleware/validate');
const { requirePermission, assertHostelScope } = require('../../middleware/authorize');
const { resolveSession } = require('../../services/rounds');
const { notFound, conflict } = require('../../lib/errors');
const { audit } = require('../../services/audit');

const router = express.Router();
const idParam = z.object({ id: z.coerce.number().int().positive() });

// ---------- Room detail: every bed with its current occupant, plus history and complaints ----------
router.get('/:id', requirePermission('hostel:read'), validate({ params: idParam }), async (req, res, next) => {
  try {
    const room = await Room.findByPk(req.params.id, { include: [{ model: Hostel, attributes: ['id', 'name', 'code', 'gender', 'allowedYears'] }] });
    if (!room) throw notFound('Room');
    const session = await resolveSession(req.query.session);
    // Students may browse rooms but only staff see who lives there.
    const staff = req.user.permissions.has('student:read');
    if (staff && !req.user.permissions.has('hostel:all')) assertHostelScope(req.user, room.hostelId);

    const beds = await sequelize.query(
      `SELECT b.id, b.label, a.id AS "allocationId", a.status,
              ${staff ? 's.id AS "studentId", s.roll_no AS "rollNo", u.name AS "studentName", s.year, s.program' : 'NULL AS "studentId"'}
         FROM beds b
         LEFT JOIN allocations a ON a.bed_id = b.id AND a.session = :session AND a.status IN (:active)
         LEFT JOIN students s ON s.id = a.student_id
         LEFT JOIN users u ON u.id = s.user_id
        WHERE b.room_id = :id ORDER BY b.label`,
      { replacements: { id: room.id, session, active: ACTIVE_STATUSES }, type: QueryTypes.SELECT }
    );
    const history = staff
      ? await sequelize.query(
        `SELECT a.id, a.session, a.status, a.source, b.label AS "bedLabel", s.id AS "studentId", s.roll_no AS "rollNo", u.name AS "studentName", a.created_at AS "createdAt"
           FROM allocations a JOIN beds b ON b.id = a.bed_id JOIN students s ON s.id = a.student_id JOIN users u ON u.id = s.user_id
          WHERE b.room_id = :id ORDER BY a.created_at DESC LIMIT 50`,
        { replacements: { id: room.id }, type: QueryTypes.SELECT }
      )
      : [];
    const complaints = staff
      ? await sequelize.query(
        `SELECT c.id, c.title, c.category, c.priority, c.status, c.created_at AS "createdAt" FROM complaints c
          WHERE c.room_id = :id ORDER BY c.created_at DESC LIMIT 20`,
        { replacements: { id: room.id }, type: QueryTypes.SELECT }
      )
      : [];
    res.json({
      session,
      data: {
        id: room.id, roomNo: room.roomNo, floor: room.floor, capacity: room.capacity, hostel: room.hostel,
        occupied: beds.filter((b) => b.allocationId).length, beds, history, complaints,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------- Change capacity (admin). Growing adds beds; shrinking only removes never-used beds. ----------
router.patch(
  '/:id',
  requirePermission('hostel:manage'),
  validate({ params: idParam, body: z.object({ capacity: z.number().int().min(1).max(6) }) }),
  async (req, res, next) => {
    try {
      const { capacity } = req.body;
      const room = await sequelize.transaction(async (t) => {
        const r = await Room.findByPk(req.params.id, { lock: t.LOCK.UPDATE, transaction: t });
        if (!r) throw notFound('Room');
        const beds = await Bed.findAll({ where: { roomId: r.id }, order: [['label', 'ASC']], transaction: t });
        if (capacity > beds.length) {
          const labels = new Set(beds.map((b) => b.label));
          const add = 'ABCDEF'.split('').filter((l) => !labels.has(l)).slice(0, capacity - beds.length);
          await Bed.bulkCreate(add.map((label) => ({ roomId: r.id, label })), { transaction: t });
        } else if (capacity < beds.length) {
          const remove = beds.slice(capacity);
          const [{ used }] = await sequelize.query(
            'SELECT COUNT(*)::int AS used FROM allocations WHERE bed_id IN (:ids)',
            { replacements: { ids: remove.map((b) => b.id) }, type: QueryTypes.SELECT, transaction: t }
          );
          if (used) throw conflict(`Cannot remove bed(s) ${remove.map((b) => b.label).join(', ')}: they have allocation history`);
          await Bed.destroy({ where: { id: remove.map((b) => b.id) }, transaction: t });
        }
        return r.update({ capacity }, { transaction: t });
      });
      audit({ action: 'ROOM_CAPACITY_CHANGED', actor: req.user, entity: 'room', entityId: room.id, data: { capacity }, requestId: req.id });
      res.json({ data: room });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
