const express = require('express');
const { z } = require('zod');
const { QueryTypes } = require('sequelize');
const sequelize = require('../../lib/db');
const { ACTIVE_STATUSES } = require('../../models');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { parseListQuery, pageMeta } = require('../../lib/pagination');
const { resolveSession } = require('../../services/rounds');
const { notFound, forbidden } = require('../../lib/errors');

const router = express.Router();

// ---------- Student directory (admin: everyone approved; warden: residents of their hostel) ----------
const listQuery = z.object({
  q: z.string().trim().max(60).optional(),
  year: z.coerce.number().int().min(1).max(5).optional(),
  gender: z.enum(['MALE', 'FEMALE']).optional(),
  allocated: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.string().optional(),
});
const SORT = { rollNo: 's.roll_no', name: 'u.name', cgpa: 's.cgpa', year: 's.year' };

router.get('/', requirePermission('student:read'), validate({ query: listQuery }), async (req, res, next) => {
  try {
    const q = req.validatedQuery;
    const session = await resolveSession();
    const list = parseListQuery(q, SORT, 'rollNo');
    const scoped = !req.user.permissions.has('hostel:all');
    const where = ["u.approval_status = 'APPROVED'"];
    if (scoped) where.push('h.id = :hid');
    if (q.q) where.push('(s.roll_no ILIKE :like OR u.name ILIKE :like OR u.email ILIKE :like)');
    if (q.year) where.push('s.year = :year');
    if (q.gender) where.push('s.gender = :gender');
    if (q.allocated === 'true') where.push('a.id IS NOT NULL');
    if (q.allocated === 'false') where.push('a.id IS NULL');
    const rows = await sequelize.query(
      `SELECT s.id, s.roll_no AS "rollNo", u.name, u.email, u.phone, s.gender, s.year, s.program, s.cgpa, s.is_pwd AS "isPwd",
              u.is_active AS "isActive", a.id AS "allocationId", a.status AS "allocationStatus",
              h.id AS "hostelId", h.name AS "hostelName", r.room_no AS "roomNo", b.label AS "bedLabel",
              COUNT(*) OVER()::int AS total_count
         FROM students s
         JOIN users u ON u.id = s.user_id
         ${scoped ? '' : 'LEFT'} JOIN allocations a ON a.student_id = s.id AND a.session = :session AND a.status IN (:active)
         LEFT JOIN beds b ON b.id = a.bed_id
         LEFT JOIN rooms r ON r.id = b.room_id
         LEFT JOIN hostels h ON h.id = r.hostel_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${list.orderSql}, s.id
        LIMIT :limit OFFSET :offset`,
      {
        replacements: { session, active: ACTIVE_STATUSES, hid: req.user.hostelId, like: `%${q.q || ''}%`, year: q.year, gender: q.gender, limit: list.limit, offset: list.offset },
        type: QueryTypes.SELECT,
      }
    );
    const total = rows[0]?.total_count ?? 0;
    res.json({ session, data: rows.map(({ total_count, ...r }) => r), meta: pageMeta(list, total) });
  } catch (err) {
    next(err);
  }
});

// ---------- Full student profile ----------
router.get('/:id', requirePermission('student:read'), validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), async (req, res, next) => {
  try {
    const id = req.params.id;
    const [profile] = await sequelize.query(
      `SELECT s.id, s.roll_no AS "rollNo", s.gender, s.year, s.program, s.cgpa, s.is_pwd AS "isPwd",
              u.id AS "userId", u.name, u.email, u.phone, u.is_active AS "isActive", u.approval_status AS "approvalStatus", u.created_at AS "registeredAt"
         FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    if (!profile) throw notFound('Student');

    const allocations = await sequelize.query(
      `SELECT a.id, a.session, a.status, a.source, a.fee_due_at AS "feeDueAt", a.created_at AS "createdAt", a.updated_at AS "updatedAt",
              h.id AS "hostelId", h.name AS "hostelName", r.id AS "roomId", r.room_no AS "roomNo", r.floor, b.label AS "bedLabel",
              (SELECT COUNT(*) FROM fee_receipts fr WHERE fr.allocation_id = a.id)::int AS receipts
         FROM allocations a JOIN beds b ON b.id = a.bed_id JOIN rooms r ON r.id = b.room_id JOIN hostels h ON h.id = r.hostel_id
        WHERE a.student_id = :id ORDER BY a.created_at DESC`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );

    // Warden scope: the student must live (or have lived) in the warden's hostel.
    if (!req.user.permissions.has('hostel:all') && !allocations.some((a) => a.hostelId === req.user.hostelId)) {
      throw forbidden('This student is not in your hostel');
    }

    const [preferences, complaints, swaps] = await Promise.all([
      sequelize.query(
        `SELECT p.rank, r.id AS "roomId", r.room_no AS "roomNo", h.name AS "hostelName", ar.session
           FROM preferences p JOIN rooms r ON r.id = p.room_id JOIN hostels h ON h.id = r.hostel_id
           JOIN allocation_rounds ar ON ar.id = p.round_id
          WHERE p.student_id = :id AND ar.status <> 'CLOSED' ORDER BY p.rank`,
        { replacements: { id }, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT c.id, c.title, c.category, c.priority, c.status, c.created_at AS "createdAt", r.room_no AS "roomNo", h.name AS "hostelName"
           FROM complaints c JOIN rooms r ON r.id = c.room_id JOIN hostels h ON h.id = r.hostel_id
          WHERE c.student_id = :id ORDER BY c.created_at DESC LIMIT 20`,
        { replacements: { id }, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT sw.id, sw.status, sw.created_at AS "createdAt",
                CASE WHEN ra.student_id = :id THEN 'requested' ELSE 'received' END AS direction
           FROM swap_requests sw JOIN allocations ra ON ra.id = sw.requester_alloc_id JOIN allocations ta ON ta.id = sw.target_alloc_id
          WHERE ra.student_id = :id OR ta.student_id = :id ORDER BY sw.created_at DESC LIMIT 20`,
        { replacements: { id }, type: QueryTypes.SELECT }
      ),
    ]);

    const current = allocations.find((a) => ACTIVE_STATUSES.includes(a.status)) || null;
    res.json({ data: { ...profile, current, allocations, preferences, complaints, swaps } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
