// End-to-end checks for registration, user management, hostels/rooms, dashboard and complaints.
// Run against a FRESHLY SEEDED database:  npm run seed && npm start  →  node scripts/e2e-advanced.js
const BASE = process.env.API_URL || 'http://localhost:4000/api/v1';
let failures = 0;
const stamp = Date.now().toString().slice(-6);

async function call(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}
function check(label, res, expected) {
  const ok = res.status === expected;
  if (!ok) failures += 1;
  const msg = res.data?.error?.message ? ` — ${res.data.error.message}` : '';
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${res.status}] ${label}${ok ? '' : ` (expected ${expected})`}${msg}`);
  return res;
}
const login = async (email, password) => (await call('POST', '/auth/login', { body: { email, password } })).data;

(async () => {
  const admin = await login('admin@hostel.edu', 'Admin@123');
  const A = admin.accessToken;

  console.log('--- Self-registration ---');
  const reg = { name: 'Test Student', email: `t${stamp}@hostel.edu`, phone: '9876543210', password: 'Strong@123', rollNo: `T${stamp}`, gender: 'MALE', year: 2, program: 'MCA', cgpa: 8.4 };
  check('weak password -> 422', await call('POST', '/auth/register', { body: { ...reg, password: 'weak' } }), 422);
  check('bad phone -> 422', await call('POST', '/auth/register', { body: { ...reg, phone: '12345' } }), 422);
  const r1 = check('register -> 201', await call('POST', '/auth/register', { body: reg }), 201);
  check('duplicate email -> 409', await call('POST', '/auth/register', { body: { ...reg, rollNo: `X${stamp}` } }), 409);
  check('duplicate roll number -> 409', await call('POST', '/auth/register', { body: { ...reg, email: `x${stamp}@hostel.edu` } }), 409);
  check('login while pending -> 403', await call('POST', '/auth/login', { body: { email: reg.email, password: reg.password } }), 403);
  const pend = check('admin lists pending', await call('GET', '/users?status=PENDING', { token: A }), 200);
  console.log(`      ${pend.data.meta.total} pending registrations`);
  check('student cannot approve -> 403', await call('PATCH', `/users/${r1.data.data.id}/approval`, { token: (await login('s00001@hostel.edu', 'Student@123')).accessToken, body: { approve: true } }), 403);
  check('admin approves', await call('PATCH', `/users/${r1.data.data.id}/approval`, { token: A, body: { approve: true } }), 200);
  check('approve twice -> 409', await call('PATCH', `/users/${r1.data.data.id}/approval`, { token: A, body: { approve: true } }), 409);
  const me = await login(reg.email, reg.password);
  console.log(`${me?.accessToken ? 'PASS' : 'FAIL'}  approved student can log in`);
  if (!me?.accessToken) failures += 1;
  const S = me.accessToken;

  console.log('--- Profile & password ---');
  check('update profile', await call('PATCH', '/auth/me', { token: S, body: { name: 'Test Student Renamed', phone: '9123456780' } }), 200);
  check('wrong current password -> 403', await call('POST', '/auth/change-password', { token: S, body: { currentPassword: 'nope', newPassword: 'Newer@1234' } }), 403);
  const cp = check('change password', await call('POST', '/auth/change-password', { token: S, body: { currentPassword: reg.password, newPassword: 'Newer@1234' } }), 200);
  check('old password no longer works -> 401', await call('POST', '/auth/login', { body: { email: reg.email, password: reg.password } }), 401);
  const S2 = cp.data.accessToken;

  console.log('--- Wardens & users ---');
  const w = check('create warden -> 201', await call('POST', '/users/wardens', { token: A, body: { name: 'New Warden', email: `w${stamp}@hostel.edu`, phone: '9988776655' } }), 201);
  const wl = await login(`w${stamp}@hostel.edu`, w.data.temporaryPassword);
  console.log(`${wl?.user?.mustChangePassword ? 'PASS' : 'FAIL'}  warden logs in with temp password and must change it`);
  if (!wl?.user?.mustChangePassword) failures += 1;
  const rp = check('reset password', await call('POST', `/users/${w.data.data.id}/reset-password`, { token: A }), 200);
  check('old temp password fails -> 401', await call('POST', '/auth/login', { body: { email: `w${stamp}@hostel.edu`, password: w.data.temporaryPassword } }), 401);
  check('deactivate warden', await call('PATCH', `/users/${w.data.data.id}`, { token: A, body: { isActive: false } }), 200);
  check('deactivated cannot log in -> 401', await call('POST', '/auth/login', { body: { email: `w${stamp}@hostel.edu`, password: rp.data.temporaryPassword } }), 401);
  check('admin cannot deactivate self -> 422', await call('PATCH', `/users/${admin.user.id}`, { token: A, body: { isActive: false } }), 422);

  console.log('--- CSV import ---');
  const csv = `name,email,rollNo,gender,year,program,cgpa,phone
"Imported One",imp1${stamp}@hostel.edu,I1${stamp},male,1,MCA,7.5,9000000001
Imported Two,imp2${stamp}@hostel.edu,I2${stamp},FEMALE,2,MSc,8.1,
Bad Row,not-an-email,I3${stamp},X,9,MCA,11,
Dup Email,imp1${stamp}@hostel.edu,I4${stamp},MALE,1,MCA,7,`;
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'students.csv');
  const imp = check('import CSV -> 201', await call('POST', '/users/import', { token: A, form: fd }), 201);
  console.log(`      created ${imp.data.data.created}, failed ${imp.data.data.failed}: ${imp.data.data.errors.map((e) => `line ${e.line}`).join(', ')}`);
  if (imp.data.data.created !== 2 || imp.data.data.failed !== 2) { failures += 1; console.log('FAIL  expected 2 created / 2 failed'); }
  const fd2 = new FormData();
  fd2.append('file', new Blob(['name,email\nx,y'], { type: 'text/csv' }), 'bad.csv');
  check('CSV missing columns -> 422', await call('POST', '/users/import', { token: A, form: fd2 }), 422);

  console.log('--- Hostels & rooms ---');
  const h = check('create hostel -> 201', await call('POST', '/hostels', { token: A, body: { name: `Test Hall ${stamp}`, code: `T${stamp.replace(/\d/g, (d) => 'ABCDEFGHIJ'[d])}`.slice(0, 8), gender: 'MALE', allowedYears: [2, 3] } }), 201);
  const hid = h.data.data.id;
  check('add 10 rooms on floor 1 -> 201', await call('POST', `/hostels/${hid}/rooms`, { token: A, body: { floor: 1, from: 1, to: 10, capacity: 2 } }), 201);
  check('overlapping rooms -> 409', await call('POST', `/hostels/${hid}/rooms`, { token: A, body: { floor: 1, from: 5, to: 12, capacity: 2 } }), 409);
  const hd = check('hostel detail', await call('GET', `/hostels/${hid}`, { token: A }), 200);
  console.log(`      ${hd.data.data.totals.rooms} rooms, ${hd.data.data.totals.beds} beds on ${hd.data.data.floors.length} floor(s)`);
  const roomId = hd.data.data.floors[0].rooms[0].id;
  check('grow room to 3 beds', await call('PATCH', `/rooms/${roomId}`, { token: A, body: { capacity: 3 } }), 200);
  check('shrink unused room to 1 bed', await call('PATCH', `/rooms/${roomId}`, { token: A, body: { capacity: 1 } }), 200);
  check('room detail', await call('GET', `/rooms/${roomId}`, { token: A }), 200);
  check('warden cannot create hostel -> 403', await call('POST', '/hostels', { token: (await login('warden1@hostel.edu', 'Warden@123')).accessToken, body: { name: 'Nope Hall', code: 'NOPE', gender: 'MALE', allowedYears: [1] } }), 403);
  const busyRoom = (await call('GET', '/hostels/2', { token: A })).data.data.floors[0].rooms[0];
  check('shrinking a room with history -> 409', await call('PATCH', `/rooms/${busyRoom.id}`, { token: A, body: { capacity: 1 } }), busyRoom.capacity > 1 ? 409 : 200);

  console.log('--- Students & dashboard ---');
  const sl = check('student directory (admin)', await call('GET', '/students?year=2&sort=-cgpa&limit=5', { token: A }), 200);
  check('student detail', await call('GET', `/students/${sl.data.data[0].id}`, { token: A }), 200);
  const d = check('dashboard (admin)', await call('GET', '/dashboard', { token: A }), 200);
  console.log(`      tiles: ${JSON.stringify(d.data.data.tiles)}`);
  check('dashboard (warden, own hostel only)', await call('GET', '/dashboard', { token: (await login('warden2@hostel.edu', 'Warden@123')).accessToken }), 200);
  check('student cannot open dashboard -> 403', await call('GET', '/dashboard', { token: S2 }), 403);

  console.log('--- Complaints ---');
  check('complaint without a room -> 409', await call('POST', '/complaints', { token: S2, body: { category: 'ELECTRICAL', title: 'Fan broken', description: 'The ceiling fan does not turn on.' } }), 409);
  // Give the new student a bed: run Round 1, open booking, book.
  const round = (await call('GET', '/rounds/current', { token: A })).data.data;
  await call('POST', `/rounds/${round.id}/run`, { token: A });
  await call('PATCH', `/rounds/${round.id}/status`, { token: A, body: { status: 'BOOKING_OPEN' } });
  const eh = (await call('GET', '/hostels?eligible=true', { token: S2 })).data.data.find((x) => x.freeBeds > 0);
  const fr = (await call('GET', `/hostels/${eh.id}/rooms?available=true&limit=1`, { token: S2 })).data.data[0];
  check('new student books a bed', await call('POST', `/rounds/${round.id}/book`, { token: S2, body: { roomId: fr.id } }), 201);
  check('short description -> 422', await call('POST', '/complaints', { token: S2, body: { category: 'ELECTRICAL', title: 'Fan', description: 'x' } }), 422);
  const c = check('raise complaint -> 201', await call('POST', '/complaints', { token: S2, body: { category: 'ELECTRICAL', priority: 'HIGH', title: 'Fan not working', description: 'The ceiling fan stopped working last night.' } }), 201);
  const cid = c.data.data.id;
  check('student cannot mark in-progress -> 403', await call('PATCH', `/complaints/${cid}/status`, { token: S2, body: { status: 'IN_PROGRESS' } }), 403);
  const ward = await login(`warden${eh.id}@hostel.edu`, 'Warden@123');
  const other = await login(`warden${eh.id === 1 ? 2 : 1}@hostel.edu`, 'Warden@123');
  check('other hostel warden -> 403', await call('PATCH', `/complaints/${cid}/status`, { token: other.accessToken, body: { status: 'IN_PROGRESS' } }), 403);
  check('warden: in progress', await call('PATCH', `/complaints/${cid}/status`, { token: ward.accessToken, body: { status: 'IN_PROGRESS', note: 'Electrician assigned' } }), 200);
  check('warden: resolved', await call('PATCH', `/complaints/${cid}/status`, { token: ward.accessToken, body: { status: 'RESOLVED', note: 'Capacitor replaced' } }), 200);
  check('invalid jump -> 409', await call('PATCH', `/complaints/${cid}/status`, { token: ward.accessToken, body: { status: 'IN_PROGRESS' } }), 409);
  const closed = check('student confirms & closes', await call('PATCH', `/complaints/${cid}/status`, { token: S2, body: { status: 'CLOSED' } }), 200);
  console.log(`      timeline: ${closed.data.data.events.map((e) => e.toStatus).join(' → ')}`);
  check('warden complaint list', await call('GET', '/complaints?status=CLOSED&sort=-createdAt', { token: ward.accessToken }), 200);
  check('other student cannot see it -> 403', await call('GET', `/complaints/${cid}`, { token: (await login('s00001@hostel.edu', 'Student@123')).accessToken }), 403);

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll advanced checks passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
