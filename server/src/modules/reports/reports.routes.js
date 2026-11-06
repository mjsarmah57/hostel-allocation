const express = require('express');
const { z } = require('zod');
const { QueryTypes } = require('sequelize');
const sequelize = require('../../lib/db');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { resolveSession } = require('../../services/rounds');

const router = express.Router();

router.get(
  '/occupancy',
  requirePermission('report:read'),
  validate({ query: z.object({ session: z.string().regex(/^\d{4}-\d{2}$/).optional() }) }),
  async (req, res, next) => {
    try {
      const session = await resolveSession(req.validatedQuery.session);
      const scoped = !req.user.permissions.has('hostel:all');
      const rows = await sequelize.query(
        `SELECT h.id, h.name, h.code, h.gender,
                COUNT(b.id)::int AS beds,
                COUNT(a.id)::int AS occupied,
                COUNT(a.id) FILTER (WHERE a.status = 'ALLOCATED')::int AS "awaitingFee",
                COUNT(a.id) FILTER (WHERE a.status = 'FEE_SUBMITTED')::int AS "feeSubmitted",
                COUNT(a.id) FILTER (WHERE a.status = 'VERIFIED')::int AS verified,
                COUNT(a.id) FILTER (WHERE a.status = 'CHECKED_IN')::int AS "checkedIn"
           FROM hostels h
           JOIN rooms r ON r.hostel_id = h.id
           JOIN beds b ON b.room_id = r.id
           LEFT JOIN allocations a ON a.bed_id = b.id AND a.session = :session
                AND a.status IN ('ALLOCATED','FEE_SUBMITTED','VERIFIED','CHECKED_IN')
          ${scoped ? 'WHERE h.id = :hid' : ''}
          GROUP BY h.id ORDER BY h.name`,
        { replacements: { session, hid: req.user.hostelId }, type: QueryTypes.SELECT }
      );
      const data = rows.map((r) => ({ ...r, free: r.beds - r.occupied, occupancyPct: r.beds ? Math.round((r.occupied / r.beds) * 1000) / 10 : 0 }));
      const totals = data.reduce((acc, r) => ({ beds: acc.beds + r.beds, occupied: acc.occupied + r.occupied }), { beds: 0, occupied: 0 });
      res.json({ session, data, totals });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
