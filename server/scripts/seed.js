// Seeds enough data for indexing to matter:
// 10 hostels, ~1,500 rooms, ~3,750 beds, 5,000 students, 4 past sessions of history,
// and a current round (2026-27) in PREFERENCES_OPEN with preferences for ~75% of students.
// Usage: npm run seed            (wipes and reseeds everything)
const bcrypt = require('bcrypt');
const env = require('../src/config/env');
const {
  sequelize, Role, Permission, RolePermission, User, Student, Hostel, Room, Bed, AllocationRound, Preference, Allocation,
} = require('../src/models');

// Deterministic pseudo-random generator so every seed produces the same data.
let state = 42;
const rand = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const shuffle = (arr) => arr.map((v) => [rand(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

const PERMISSIONS = {
  student: ['hostel:read', 'round:read', 'preference:submit', 'booking:create', 'allocation:read_own', 'receipt:upload', 'swap:create'],
  warden: ['hostel:read', 'round:read', 'allocation:read', 'allocation:update', 'receipt:verify', 'swap:approve', 'report:read'],
  admin: [
    'hostel:read', 'hostel:all', 'round:read', 'round:manage', 'allocation:run', 'allocation:read', 'allocation:update',
    'allocation:release', 'receipt:verify', 'swap:approve', 'report:read', 'audit:read',
  ],
};

const HOSTELS = [
  { name: 'Aryabhata Hall', code: 'ARY', gender: 'MALE', allowedYears: [1] },
  { name: 'Bhaskara Hall', code: 'BHA', gender: 'MALE', allowedYears: [2, 3, 4, 5] },
  { name: 'Charaka Hall', code: 'CHA', gender: 'MALE', allowedYears: [2, 3, 4, 5] },
  { name: 'Dhanvantari Hall', code: 'DHA', gender: 'MALE', allowedYears: [1, 2] },
  { name: 'Panini Hall', code: 'PAN', gender: 'MALE', allowedYears: [3, 4, 5] },
  { name: 'Ramanujan Hall', code: 'RAM', gender: 'MALE', allowedYears: [2, 3, 4, 5] },
  { name: 'Gargi Hall', code: 'GAR', gender: 'FEMALE', allowedYears: [1] },
  { name: 'Maitreyi Hall', code: 'MAI', gender: 'FEMALE', allowedYears: [2, 3, 4, 5] },
  { name: 'Lilavati Hall', code: 'LIL', gender: 'FEMALE', allowedYears: [1, 2, 3] },
  { name: 'Kalpana Hall', code: 'KAL', gender: 'FEMALE', allowedYears: [3, 4, 5] },
];
const FIRST = {
  MALE: ['Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Rohan', 'Kabir', 'Ishaan', 'Rahul', 'Nikhil', 'Siddharth', 'Pranjal', 'Dhruv'],
  FEMALE: ['Ananya', 'Diya', 'Priya', 'Meera', 'Sneha', 'Kavya', 'Riya', 'Pooja', 'Tanvi', 'Aisha', 'Nandini', 'Ishita'],
};
const LAST = ['Sharma', 'Verma', 'Gupta', 'Das', 'Sarmah', 'Bora', 'Iyer', 'Nair', 'Reddy', 'Singh', 'Khan', 'Mehta', 'Joshi', 'Patel', 'Rao', 'Ghosh'];
const PROGRAMS = { 1: ['BTech', 'MCA', 'MSc', 'MTech'], 2: ['BTech', 'MCA', 'MSc', 'MTech'], 3: ['BTech', 'PhD'], 4: ['BTech', 'PhD'], 5: ['PhD'] };

const STUDENTS = 5000;

async function main() {
  console.time('seed');
  console.log('Clearing tables...');
  await sequelize.query(`TRUNCATE fee_receipts, swap_requests, allocations, preferences, allocation_rounds,
    beds, rooms, hostels, students, refresh_tokens, users, role_permissions, permissions, roles RESTART IDENTITY CASCADE`);

  // ---------- RBAC ----------
  const allCodes = [...new Set(Object.values(PERMISSIONS).flat())];
  const perms = await Permission.bulkCreate(allCodes.map((code) => ({ code })), { returning: true });
  const permId = Object.fromEntries(perms.map((p) => [p.code, p.id]));
  const roles = {};
  for (const name of Object.keys(PERMISSIONS)) {
    roles[name] = await Role.create({ name });
    await RolePermission.bulkCreate(PERMISSIONS[name].map((c) => ({ roleId: roles[name].id, permissionId: permId[c] })));
  }

  // ---------- Staff ----------
  const rounds = env.BCRYPT_ROUNDS;
  const [adminHash, wardenHash, studentHash] = await Promise.all([
    bcrypt.hash('Admin@123', rounds), bcrypt.hash('Warden@123', rounds), bcrypt.hash('Student@123', rounds),
  ]);
  await User.create({ email: 'admin@hostel.edu', name: 'Chief Warden (Admin)', passwordHash: adminHash, roleId: roles.admin.id });

  // ---------- Hostels, rooms, beds ----------
  console.log('Creating hostels, rooms and beds...');
  const hostels = [];
  for (const [i, h] of HOSTELS.entries()) {
    const warden = await User.create({
      email: `warden${i + 1}@hostel.edu`, name: `Warden ${h.name.split(' ')[0]}`, passwordHash: wardenHash, roleId: roles.warden.id,
    });
    hostels.push(await Hostel.create({ ...h, wardenId: warden.id }));
  }
  const roomRows = [];
  for (const h of hostels) {
    for (let floor = 0; floor < 5; floor += 1) {
      for (let n = 1; n <= 30; n += 1) {
        const r = rand();
        roomRows.push({ hostelId: h.id, floor, roomNo: `${floor}${String(n).padStart(2, '0')}`, capacity: r < 0.1 ? 1 : r < 0.4 ? 2 : 3 });
      }
    }
  }
  const rooms = await Room.bulkCreate(roomRows, { returning: true });
  const bedRows = rooms.flatMap((room) => Array.from({ length: room.capacity }, (_, k) => ({ roomId: room.id, label: 'ABC'[k] })));
  const beds = [];
  for (const part of chunk(bedRows, 2000)) beds.push(...(await Bed.bulkCreate(part, { returning: true })));

  const roomsByHostel = new Map(hostels.map((h) => [h.id, rooms.filter((r) => r.hostelId === h.id)]));
  const bedsByHostel = new Map(hostels.map((h) => [h.id, []]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  for (const b of beds) bedsByHostel.get(roomById.get(b.roomId).hostelId).push(b.id);

  // ---------- Students ----------
  console.log(`Creating ${STUDENTS} students...`);
  const studentSpecs = [];
  for (let i = 1; i <= STUDENTS; i += 1) {
    const gender = rand() < 0.6 ? 'MALE' : 'FEMALE';
    const y = rand();
    const year = y < 0.3 ? 1 : y < 0.55 ? 2 : y < 0.75 ? 3 : y < 0.92 ? 4 : 5;
    const idx = String(i).padStart(5, '0');
    studentSpecs.push({
      user: { email: `s${idx}@hostel.edu`, name: `${pick(FIRST[gender])} ${pick(LAST)}`, passwordHash: studentHash, roleId: roles.student.id },
      student: { rollNo: `HR${idx}`, gender, year, program: pick(PROGRAMS[year]), cgpa: (5 + rand() * 5).toFixed(2), isPwd: rand() < 0.01 },
    });
  }
  // Fixed demo accounts with known profiles.
  const demo = [
    ['Aarav Sharma', { gender: 'MALE', year: 2, program: 'MCA', cgpa: '8.75' }],
    ['Rohan Das', { gender: 'MALE', year: 2, program: 'MCA', cgpa: '7.90' }],
    ['Ananya Iyer', { gender: 'FEMALE', year: 1, program: 'MCA', cgpa: '9.10' }],
  ];
  demo.forEach(([name, profile], k) => {
    studentSpecs[k].user.name = name;
    Object.assign(studentSpecs[k].student, profile);
  });

  const students = [];
  for (const part of chunk(studentSpecs, 1000)) {
    const users = await User.bulkCreate(part.map((s) => s.user), { returning: true });
    students.push(...(await Student.bulkCreate(part.map((s, k) => ({ ...s.student, userId: users[k].id })), { returning: true })));
  }
  const eligibleHostels = (s) => hostels.filter((h) => h.gender === s.gender && h.allowedYears.includes(s.year));

  // ---------- History: 4 past sessions (VACATED) so reports and indexes have volume ----------
  console.log('Creating past sessions...');
  const past = ['2022-23', '2023-24', '2024-25', '2025-26'];
  for (const session of past) {
    const round = await AllocationRound.create({ session, name: `Allocation ${session}`, status: 'CLOSED', allocatedAt: new Date(`${session.slice(0, 4)}-07-15`) });
    const used = new Set();
    const rows = [];
    for (const s of shuffle(students).slice(0, 3500)) {
      const options = eligibleHostels(s);
      if (!options.length) continue;
      const pool = bedsByHostel.get(pick(options).id);
      for (let tries = 0; tries < 5; tries += 1) {
        const bedId = pick(pool);
        if (!used.has(bedId)) {
          used.add(bedId);
          rows.push({ session, studentId: s.id, bedId, roundId: round.id, status: 'VACATED', source: 'LEGACY', createdAt: new Date(`${session.slice(0, 4)}-07-15`) });
          break;
        }
      }
    }
    for (const part of chunk(rows, 2000)) await Allocation.bulkCreate(part);
  }

  // ---------- Current round with preferences ----------
  console.log('Creating current round and preferences...');
  const current = await AllocationRound.create({ session: '2026-27', name: 'Allocation 2026-27', status: 'PREFERENCES_OPEN', feeWindowDays: 7 });
  // Students 1..3 are demo accounts: #1 and #3 submit preferences live in the demo; #2 has some already.
  const withPrefs = shuffle(students.slice(3)).slice(0, Math.floor(STUDENTS * 0.75));
  withPrefs.push(students[1]);
  const prefRows = [];
  for (const s of withPrefs) {
    const options = eligibleHostels(s);
    if (!options.length) continue;
    // Mild bias towards lower floors gives realistic contention without starving everyone.
    const candidateRooms = options
      .flatMap((h) => roomsByHostel.get(h.id))
      .map((r) => ({ r, key: r.floor + rand() * 12 }))
      .sort((a, b) => a.key - b.key)
      .slice(0, 2 + Math.floor(rand() * 4))
      .map(({ r }) => r);
    candidateRooms.forEach((r, k) => prefRows.push({ roundId: current.id, studentId: s.id, roomId: r.id, rank: k + 1 }));
  }
  for (const part of chunk(prefRows, 3000)) await Preference.bulkCreate(part);

  await sequelize.query('ANALYZE');
  const [[counts]] = await sequelize.query(`SELECT
    (SELECT COUNT(*) FROM students) AS students, (SELECT COUNT(*) FROM rooms) AS rooms, (SELECT COUNT(*) FROM beds) AS beds,
    (SELECT COUNT(*) FROM allocations) AS allocations, (SELECT COUNT(*) FROM preferences) AS preferences`);
  console.table(counts);
  console.log(`
Demo accounts
  admin@hostel.edu      / Admin@123     (admin: all hostels)
  warden1@hostel.edu    / Warden@123    (${hostels[0].name}) ... warden10@hostel.edu
  s00001@hostel.edu     / Student@123   (HR00001, male, year 2, no preferences yet)
  s00002@hostel.edu     / Student@123   (HR00002, male, year 2, has preferences)
  s00003@hostel.edu     / Student@123   (HR00003, female, year 1)
Current round 2026-27 is PREFERENCES_OPEN (id ${current.id}).`);
  console.timeEnd('seed');
  await sequelize.close();
}

main().catch(async (err) => {
  console.error(err);
  await sequelize.close();
  process.exit(1);
});
