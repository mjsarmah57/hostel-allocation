const express = require('express');
const { z } = require('zod');
const { QueryTypes } = require('sequelize');
const sequelize = require('../../lib/db');
const { Hostel, Student, ACTIVE_STATUSES } = require('../../models');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { parseListQuery, pageMeta } = require('../../lib/pagination');
const { resolveSession } = require('../../services/rounds');
const { notFound } = require('../../lib/errors');

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

module.exports = router;
