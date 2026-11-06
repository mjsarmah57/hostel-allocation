const express = require('express');
const { QueryTypes } = require('sequelize');
const sequelize = require('../../lib/db');
const { requirePermission } = require('../../middleware/authorize');
const { resolveSession, getCurrentRound } = require('../../services/rounds');

const router = express.Router();
const q = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

// One call that feeds every tile and chart on the dashboard. Wardens see only their hostel.
router.get('/', requirePermission('dashboard:read'), async (req, res, next) => {
  try {
    const session = await resolveSession(req.query.session);
    const round = await getCurrentRound();
    const scoped = !req.user.permissions.has('hostel:all');
    const hid = req.user.hostelId;
    const H = scoped ? 'AND h.id = :hid' : '';
    const r = { session, hid };

    const [occupancy, statusRows, sourceRows, complaintRows, trend, [counts], rankRows, recent] = await Promise.all([
      q(`SELECT h.id, h.name, h.code, h.gender, COUNT(b.id)::int AS beds, COUNT(a.id)::int AS occupied
           FROM hostels h JOIN rooms rm ON rm.hostel_id = h.id JOIN beds b ON b.room_id = rm.id
           LEFT JOIN allocations a ON a.bed_id = b.id AND a.session = :session AND a.status IN ('ALLOCATED','FEE_SUBMITTED','VERIFIED','CHECKED_IN')
          WHERE TRUE ${H} GROUP BY h.id ORDER BY h.name`, r),
      q(`SELECT a.status, COUNT(*)::int AS count FROM allocations a JOIN beds b ON b.id = a.bed_id JOIN rooms rm ON rm.id = b.room_id JOIN hostels h ON h.id = rm.hostel_id
          WHERE a.session = :session ${H} GROUP BY a.status`, r),
      q(`SELECT a.source, COUNT(*)::int AS count FROM allocations a JOIN beds b ON b.id = a.bed_id JOIN rooms rm ON rm.id = b.room_id JOIN hostels h ON h.id = rm.hostel_id
          WHERE a.session = :session AND a.status IN ('ALLOCATED','FEE_SUBMITTED','VERIFIED','CHECKED_IN') ${H} GROUP BY a.source`, r),
      q(`SELECT c.category, COUNT(*) FILTER (WHERE c.status IN ('OPEN','IN_PROGRESS'))::int AS open, COUNT(*)::int AS total
           FROM complaints c JOIN rooms rm ON rm.id = c.room_id JOIN hostels h ON h.id = rm.hostel_id
          WHERE TRUE ${H} GROUP BY c.category ORDER BY total DESC`, r),
      q(`SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(x.count, 0)::int AS count
           FROM generate_series(current_date - 13, current_date, interval '1 day') d
           LEFT JOIN (SELECT a.created_at::date AS day, COUNT(*) AS count FROM allocations a
                        JOIN beds b ON b.id = a.bed_id JOIN rooms rm ON rm.id = b.room_id JOIN hostels h ON h.id = rm.hostel_id
                       WHERE a.created_at >= current_date - 13 ${H} GROUP BY 1) x ON x.day = d::date
          ORDER BY d`, r),
      q(`SELECT (SELECT COUNT(*) FROM students s JOIN users u ON u.id = s.user_id WHERE u.approval_status = 'APPROVED')::int AS students,
                (SELECT COUNT(*) FROM users WHERE approval_status = 'PENDING')::int AS "pendingRegistrations",
                (SELECT COUNT(*) FROM swap_requests WHERE status = 'PENDING_WARDEN')::int AS "pendingSwaps"`, r),
      q(`SELECT p.rank, COUNT(*)::int AS count FROM allocations a
           JOIN beds b ON b.id = a.bed_id JOIN rooms rm ON rm.id = b.room_id JOIN hostels h ON h.id = rm.hostel_id
           JOIN preferences p ON p.round_id = a.round_id AND p.student_id = a.student_id AND p.room_id = rm.id
          WHERE a.session = :session AND a.source = 'PRIORITY' ${H} GROUP BY p.rank ORDER BY p.rank`, r),
      q(`SELECT a.id, a.status, a.source, a.created_at AS "createdAt", s.id AS "studentId", s.roll_no AS "rollNo", u.name AS "studentName",
                h.name AS "hostelName", rm.room_no AS "roomNo", b.label AS "bedLabel"
           FROM allocations a JOIN students s ON s.id = a.student_id JOIN users u ON u.id = s.user_id
           JOIN beds b ON b.id = a.bed_id JOIN rooms rm ON rm.id = b.room_id JOIN hostels h ON h.id = rm.hostel_id
          WHERE a.session = :session ${H} ORDER BY a.updated_at DESC LIMIT 8`, r),
    ]);

    const beds = occupancy.reduce((n, h) => n + h.beds, 0);
    const occupied = occupancy.reduce((n, h) => n + h.occupied, 0);
    const byStatus = Object.fromEntries(statusRows.map((x) => [x.status, x.count]));
    const priorityTotal = (sourceRows.find((x) => x.source === 'PRIORITY') || {}).count || 0;
    const rankedTotal = rankRows.reduce((n, x) => n + x.count, 0);

    res.json({
      session,
      scope: scoped ? 'hostel' : 'all',
      data: {
        round: round ? { id: round.id, session: round.session, status: round.status, name: round.name } : null,
        tiles: {
          beds, occupied, free: beds - occupied, occupancyPct: beds ? Math.round((occupied / beds) * 1000) / 10 : 0,
          awaitingFee: byStatus.ALLOCATED || 0, feeSubmitted: byStatus.FEE_SUBMITTED || 0, verified: byStatus.VERIFIED || 0, checkedIn: byStatus.CHECKED_IN || 0,
          openComplaints: complaintRows.reduce((n, c) => n + c.open, 0),
          ...(scoped ? {} : counts),
        },
        occupancyByHostel: occupancy.map((h) => ({ ...h, free: h.beds - h.occupied, pct: h.beds ? Math.round((h.occupied / h.beds) * 100) : 0 })),
        statusBreakdown: ['ALLOCATED', 'FEE_SUBMITTED', 'VERIFIED', 'CHECKED_IN', 'RELEASED', 'VACATED', 'SWAPPED'].map((s) => ({ status: s, count: byStatus[s] || 0 })),
        sourceBreakdown: sourceRows,
        preferenceRank: [
          ...rankRows.map((x) => ({ label: `Choice ${x.rank}`, count: x.count })),
          { label: 'Hostel fallback', count: Math.max(0, priorityTotal - rankedTotal) },
        ],
        complaintsByCategory: complaintRows,
        allocationsTrend: trend,
        recent,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
