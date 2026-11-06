// =====================================================================
// THE viva demo: N students fire "book" at the same room, which has
// exactly ONE free bed, at the same instant.
// Expected: exactly one 201 and N-1 409s, and exactly one row in the DB.
//
// Usage (API running, round in BOOKING_OPEN):
//   npm run demo:concurrency            -> 50 students
//   npm run demo:concurrency -- 100     -> 100 students
//
// Tokens are minted directly with the server's JWT secret so that 50
// logins don't trip the login rate limiter; the booking requests
// themselves go through the real HTTP API.
// =====================================================================
const { QueryTypes } = require('sequelize');
const sequelize = require('../src/lib/db');
const { AllocationRound, Allocation, ACTIVE_STATUSES } = require('../src/models');
const { buildClaims, signAccessToken } = require('../src/services/tokens');

const N = Number(process.argv[2]) || 50;
const API = process.env.API_URL || 'http://localhost:4000/api/v1';

(async () => {
  const round = await AllocationRound.findOne({ where: { status: 'BOOKING_OPEN' } });
  if (!round) {
    console.error('No round is in BOOKING_OPEN. Log in as admin and open booking first (PATCH /rounds/:id/status).');
    process.exit(1);
  }

  // Find a hostel/room with free beds AND enough eligible students who hold no bed this session.
  const candidates = await sequelize.query(
    `WITH free AS (
       SELECT r.id AS room_id, r.room_no, h.id AS hostel_id, h.name AS hostel, h.gender, h.allowed_years,
              COUNT(b.id) FILTER (WHERE a.id IS NULL) AS free_beds
         FROM rooms r JOIN hostels h ON h.id = r.hostel_id
         JOIN beds b ON b.room_id = r.id
         LEFT JOIN allocations a ON a.bed_id = b.id AND a.session = :session AND a.status IN (:active)
        GROUP BY r.id, h.id
       HAVING COUNT(b.id) FILTER (WHERE a.id IS NULL) > 0)
     SELECT f.*, (SELECT COUNT(*) FROM students s
                   WHERE s.gender = f.gender AND s.year = ANY(f.allowed_years)
                     AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.student_id = s.id AND a.session = :session AND a.status IN (:active))
                 )::int AS eligible_unallocated
       FROM free f
      ORDER BY f.free_beds ASC, f.room_id
      LIMIT 200`,
    { replacements: { session: round.session, active: ACTIVE_STATUSES }, type: QueryTypes.SELECT }
  );
  const target = candidates.find((c) => c.eligible_unallocated >= N + Number(c.free_beds));
  if (!target) {
    console.error(`Could not find a room with ${N} eligible, unallocated students. Try a smaller N or reseed.`);
    process.exit(1);
  }

  const students = await sequelize.query(
    `SELECT s.id, s.user_id AS "userId", s.roll_no AS "rollNo" FROM students s
      WHERE s.gender = :gender AND s.year = ANY(:years::int[])
        AND NOT EXISTS (SELECT 1 FROM allocations a WHERE a.student_id = s.id AND a.session = :session AND a.status IN (:active))
      ORDER BY s.id LIMIT :n`,
    {
      replacements: { gender: target.gender, years: `{${target.allowed_years.join(',')}}`, session: round.session, active: ACTIVE_STATUSES, n: N + Number(target.free_beds) - 1 },
      type: QueryTypes.SELECT,
    }
  );

  const tokenFor = async (s) => signAccessToken((await buildClaims(s.userId)).claims);
  const book = async (token) => {
    const res = await fetch(`${API}/rounds/${round.id}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ roomId: target.room_id }),
    });
    return { status: res.status, body: await res.json() };
  };

  // Setup: fill the room until exactly ONE bed is left (through the API, one at a time).
  const fillers = students.slice(0, Number(target.free_beds) - 1);
  for (const s of fillers) await book(await tokenFor(s));
  const racers = students.slice(fillers.length, fillers.length + N);
  const tokens = await Promise.all(racers.map(tokenFor));

  console.log(`\nRoom ${target.room_no} in ${target.hostel} now has exactly 1 free bed.`);
  console.log(`Firing ${N} simultaneous POST /rounds/${round.id}/book requests...\n`);

  const started = Date.now();
  const results = await Promise.all(tokens.map((t) => book(t)));
  const ms = Date.now() - started;

  const tally = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  const winnerIdx = results.findIndex((r) => r.status === 201);
  console.log('HTTP status counts:', tally);
  if (winnerIdx >= 0) console.log(`Winner: ${racers[winnerIdx].rollNo} -> bed ${results[winnerIdx].body.data.bedLabel}`);
  const sample409 = results.find((r) => r.status === 409);
  if (sample409) console.log(`Sample 409 message: "${sample409.body.error.message}"`);
  console.log(`All ${N} requests completed in ${ms} ms`);

  // Verify in the database, not just over HTTP.
  const [{ active_in_room: inRoom, capacity }] = await sequelize.query(
    `SELECT COUNT(a.id)::int AS active_in_room, MAX(r.capacity) AS capacity
       FROM rooms r JOIN beds b ON b.room_id = r.id
       LEFT JOIN allocations a ON a.bed_id = b.id AND a.session = :session AND a.status IN (:active)
      WHERE r.id = :roomId`,
    { replacements: { session: round.session, active: ACTIVE_STATUSES, roomId: target.room_id }, type: QueryTypes.SELECT }
  );
  const racerRows = await Allocation.count({ where: { studentId: racers.map((s) => s.id), session: round.session, status: ACTIVE_STATUSES } });

  const pass = tally[201] === 1 && tally[409] === N - 1 && racerRows === 1 && inRoom === Number(capacity);
  console.log(`\nDB check: room occupancy ${inRoom}/${capacity}, racers holding a bed: ${racerRows}`);
  console.log(pass ? 'RESULT: PASS: exactly one booking succeeded, no double allocation.' : 'RESULT: FAIL');
  await sequelize.close();
  process.exit(pass ? 0 : 1);
})().catch(async (err) => {
  console.error(err);
  await sequelize.close();
  process.exit(1);
});
