// End-to-end walkthrough of the whole allocation cycle against a FRESHLY SEEDED database.
// Usage: npm run seed && npm start   (in one terminal)
//        node scripts/e2e-check.js   (in another)
// Each step prints PASS/FAIL with the HTTP status it got.
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = process.env.API_URL || 'http://localhost:4000/api/v1';
let failures = 0;

async function call(method, url, { token, body, cookie, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
}

function check(label, res, expected) {
  const pass = res.status === expected;
  if (!pass) failures += 1;
  const msg = res.data?.error?.message ? ` — ${res.data.error.message}` : '';
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${res.status}] ${label}${pass ? '' : ` (expected ${expected})`}${msg}`);
  return res;
}

async function login(email, password) {
  const r = await call('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
  return { token: r.data.accessToken, user: r.data.user, cookie: r.setCookie.split(';')[0] };
}

(async () => {
  console.log('--- Auth ---');
  check('wrong password -> 401', await call('POST', '/auth/login', { body: { email: 'admin@hostel.edu', password: 'nope' } }), 401);
  check('bad email -> 422', await call('POST', '/auth/login', { body: { email: 'not-an-email', password: 'x' } }), 422);
  const admin = await login('admin@hostel.edu', 'Admin@123');
  const s1 = await login('s00001@hostel.edu', 'Student@123');
  const s3 = await login('s00003@hostel.edu', 'Student@123');
  check('no token -> 401', await call('GET', '/auth/me'), 401);
  check('GET /auth/me', await call('GET', '/auth/me', { token: s1.token }), 200);
  const ref = check('refresh rotates token', await call('POST', '/auth/refresh', { cookie: s1.cookie }), 200);
  check('reusing the OLD refresh token -> 401 (reuse detection)', await call('POST', '/auth/refresh', { cookie: s1.cookie }), 401);
  check('…and that revoked the rotated one too -> 401', await call('POST', '/auth/refresh', { cookie: ref.setCookie.split(';')[0] }), 401);

  console.log('--- Preferences (Round 1) ---');
  const round = (await call('GET', '/rounds/current', { token: s1.token })).data.data;
  const hostels = check('eligible hostels for HR00001', await call('GET', '/hostels?eligible=true', { token: s1.token }), 200).data.data;
  const eligible = hostels[0];
  const rooms = check('rooms list paginated', await call('GET', `/hostels/${eligible.id}/rooms?page=1&limit=5&sort=-floor`, { token: s1.token }), 200).data;
  console.log(`      ${rooms.meta.total} rooms in ${eligible.name}, hasNext=${rooms.meta.hasNext}`);
  const roomIds = rooms.data.slice(0, 3).map((r) => r.id);
  check('submit 3 preferences', await call('PUT', `/rounds/${round.id}/preferences`, { token: s1.token, body: { roomIds } }), 200);
  check('duplicate rooms -> 422', await call('PUT', `/rounds/${round.id}/preferences`, { token: s1.token, body: { roomIds: [roomIds[0], roomIds[0]] } }), 422);
  const girlsHostel = (await call('GET', '/hostels', { token: admin.token })).data.data.find((h) => h.gender === 'FEMALE');
  const girlsRoom = (await call('GET', `/hostels/${girlsHostel.id}/rooms?limit=1`, { token: admin.token })).data.data[0];
  check('ineligible hostel room -> 422', await call('PUT', `/rounds/${round.id}/preferences`, { token: s1.token, body: { roomIds: [girlsRoom.id] } }), 422);
  check('student cannot run allocation -> 403', await call('POST', `/rounds/${round.id}/run`, { token: s1.token }), 403);

  console.log('--- Run priority allocation ---');
  const run = check('admin runs Round 1', await call('POST', `/rounds/${round.id}/run`, { token: admin.token }), 200);
  console.log('      summary:', JSON.stringify(run.data.data));
  check('running twice -> 409', await call('POST', `/rounds/${round.id}/run`, { token: admin.token }), 409);
  const mine = check('HR00001 sees allocation', await call('GET', '/allocations/me', { token: s1.token }), 200).data.data;
  console.log(mine ? `      HR00001 -> ${mine.bed.room.hostel.name} room ${mine.bed.room.roomNo} bed ${mine.bed.label} (${mine.status})` : "      HR00001 got none of his preferences (outranked) - will book in Round 2");

  console.log('--- Round 2 open booking ---');
  check('booking before it opens -> 409', await call('POST', `/rounds/${round.id}/book`, { token: s3.token, body: { roomId: girlsRoom.id } }), 409);
  check('invalid round transition -> 409', await call('PATCH', `/rounds/${round.id}/status`, { token: admin.token, body: { status: 'PREFERENCES_OPEN' } }), 409);
  check('open booking', await call('PATCH', `/rounds/${round.id}/status`, { token: admin.token, body: { status: 'BOOKING_OPEN' } }), 200);
  const s3Hostel = (await call('GET', '/hostels?eligible=true', { token: s3.token })).data.data.find((h) => h.freeBeds > 0);
  const freeRoom = (await call('GET', `/hostels/${s3Hostel.id}/rooms?available=true&limit=1`, { token: s3.token })).data.data[0];
  const booked = check('HR00003 books a bed -> 201', await call('POST', `/rounds/${round.id}/book`, { token: s3.token, body: { roomId: freeRoom.id } }), 201);
  check('second booking by same student -> 409', await call('POST', `/rounds/${round.id}/book`, { token: s3.token, body: { roomId: freeRoom.id } }), 409);

  console.log('--- Fee receipt + lifecycle ---');
  const allocId = booked.data.data.id;
  const tmp = path.join(os.tmpdir(), 'receipt.pdf');
  fs.writeFileSync(tmp, '%PDF-1.4\n% demo receipt\n');
  const fake = path.join(os.tmpdir(), 'fake.pdf');
  fs.writeFileSync(fake, 'this is not a pdf');
  const form = (file, type) => { const f = new FormData(); f.append('receipt', new Blob([fs.readFileSync(file)], { type }), path.basename(file)); return f; };
  check('upload .txt disguised as pdf -> 415', await call('POST', `/allocations/${allocId}/receipt`, { token: s3.token, form: form(fake, 'application/pdf') }), 415);
  check('upload wrong mime -> 415', await call('POST', `/allocations/${allocId}/receipt`, { token: s3.token, form: form(fake, 'text/plain') }), 415);
  check('other student uploads to my allocation -> 403', await call('POST', `/allocations/${allocId}/receipt`, { token: s1.token, form: form(tmp, 'application/pdf') }), 403);
  check('upload real PDF -> 201', await call('POST', `/allocations/${allocId}/receipt`, { token: s3.token, form: form(tmp, 'application/pdf') }), 201);
  check('check-in before verification -> 409', await call('PATCH', `/allocations/${allocId}/status`, { token: admin.token, body: { status: 'CHECKED_IN' } }), 409);

  const hostelId = s3Hostel.id;
  const wardenNo = hostelId; // wardens were created in hostel order: hostel id N -> wardenN
  const warden = await login(`warden${wardenNo}@hostel.edu`, 'Warden@123');
  const otherWarden = await login(`warden${wardenNo === 1 ? 2 : 1}@hostel.edu`, 'Warden@123');
  check('warden of ANOTHER hostel verifies -> 403', await call('PATCH', `/allocations/${allocId}/status`, { token: otherWarden.token, body: { status: 'VERIFIED' } }), 403);
  check('warden of ANOTHER hostel lists this hostel -> 403', await call('GET', `/allocations?hostelId=${hostelId}`, { token: otherWarden.token }), 403);
  check('own warden downloads receipt', await call('GET', `/allocations/${allocId}/receipt`, { token: warden.token }), 200);
  check('own warden verifies', await call('PATCH', `/allocations/${allocId}/status`, { token: warden.token, body: { status: 'VERIFIED' } }), 200);
  check('own warden checks in', await call('PATCH', `/allocations/${allocId}/status`, { token: warden.token, body: { status: 'CHECKED_IN' } }), 200);
  const list = check('warden list: filter+sort+page', await call('GET', '/allocations?status=CHECKED_IN&sort=-createdAt&page=1&limit=10', { token: warden.token }), 200);
  console.log(`      ${list.data.meta.total} checked-in in warden's hostel`);

  if (!mine) {
    const h = (await call('GET', '/hostels?eligible=true', { token: s1.token })).data.data.find((x) => x.freeBeds > 0);
    const r = (await call('GET', `/hostels/${h.id}/rooms?available=true&limit=1`, { token: s1.token })).data.data[0];
    check('HR00001 books in Round 2 instead', await call('POST', `/rounds/${round.id}/book`, { token: s1.token, body: { roomId: r.id } }), 201);
  }

  console.log('--- Swap ---');
  // Find a student of the same gender/year as HR00001 who also holds a bed, via the admin list.
  const s1Alloc = (await call('GET', '/allocations/me', { token: s1.token })).data.data;
  const s1HostelId = s1Alloc.bed.room.hostel.id;
  const peers = (await call('GET', `/allocations?hostelId=${s1HostelId}&status=ALLOCATED&limit=50`, { token: admin.token })).data.data;
  const peer = peers.find((p) => p.rollNo !== 'HR00001' && p.year === 2);
  const peerNo = peer.rollNo.slice(2);
  const sp = await login(`s${peerNo}@hostel.edu`, 'Student@123');
  const swap = check(`HR00001 requests swap with ${peer.rollNo}`, await call('POST', '/swaps', { token: s1.token, body: { targetRollNo: peer.rollNo } }), 201);
  check('duplicate pending swap -> 409', await call('POST', '/swaps', { token: s1.token, body: { targetRollNo: peer.rollNo } }), 409);
  check('requester cannot accept own swap -> 403', await call('PATCH', `/swaps/${swap.data.data.id}/respond`, { token: s1.token, body: { accept: true } }), 403);
  check('peer accepts', await call('PATCH', `/swaps/${swap.data.data.id}/respond`, { token: sp.token, body: { accept: true } }), 200);
  const approved = check('admin approves (atomic swap)', await call('PATCH', `/swaps/${swap.data.data.id}/decision`, { token: admin.token, body: { approve: true } }), 200);
  console.log(`      now: ${approved.data.data.requesterRollNo} ↔ ${approved.data.data.targetRollNo}`);
  const after = (await call('GET', '/allocations/me', { token: s1.token })).data.data;
  const swappedOk = after.bed.room.roomNo === peer.roomNo && after.bed.label === peer.bedLabel;
  console.log(`${swappedOk ? 'PASS' : 'FAIL'}  HR00001 now sleeps in room ${after.bed.room.roomNo} bed ${after.bed.label}`);
  if (!swappedOk) failures += 1;

  console.log('--- Reports, docs, errors ---');
  check('occupancy report (admin)', await call('GET', '/reports/occupancy', { token: admin.token }), 200);
  check('student cannot read reports -> 403', await call('GET', '/reports/occupancy', { token: s1.token }), 403);
  check('unknown route -> 404', await call('GET', '/nope', { token: admin.token }), 404);
  check('release-unpaid job', await call('POST', '/admin/jobs/release-unpaid', { token: admin.token }), 200);

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
