// Uji integrasi API. Butuh PostgreSQL: TEST_DATABASE_URL (default postgres://postgres@localhost:5432/ekakarsa_test)
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/ekakarsa_test';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin-test-123';
process.env.REQUIRED_APPROVALS = '1';
process.env.TRUST_PROXY = 'false';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const request = require('supertest');
const { pool, migrate } = require('../src/db');
const { createApp } = require('../src/app');

let app;
const H = { 'X-Requested-With': 'EkakarsaPoint' };
const agents = {};

async function login(username, password) {
  const a = request.agent(app);
  const r = await a.post('/api/auth/login').set(H).send({ username, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return a;
}

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ log: () => {} });
  app = createApp();
  agents.admin = await login('admin', 'admin-test-123');
  for (const [u, role] of [['pembina', 'pembina'], ['ketua', 'ketua'], ['calon', 'calon_ketua']]) {
    const r = await agents.admin.post('/api/users').set(H).send({ username: u, name: `Bapak ${u}`, role, password: 'password-123' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    agents[u] = await login(u, 'password-123');
  }
});
after(() => pool.end());

test('publik bisa membaca tapi tidak bisa mengubah', async () => {
  const s = await request(app).get('/api/summary');
  assert.equal(s.status, 200);
  assert.equal(s.body.divisions.length, 10);
  const r = await request(app).post('/api/members').set(H).send({ name: 'X' });
  assert.equal(r.status, 401);
  const v = await request(app).get('/api/violations');
  assert.equal(v.status, 401);
});

test('tanpa header CSRF ditolak', async () => {
  const r = await agents.admin.post('/api/members').send({ name: 'Y' });
  assert.equal(r.status, 403);
});

test('login salah ditolak', async () => {
  const r = await request(app).post('/api/auth/login').set(H).send({ username: 'admin', password: 'salah' });
  assert.equal(r.status, 401);
});

test('pembina tidak bisa menambah poin (khusus admin)', async () => {
  const r = await agents.pembina.post('/api/members').set(H).send({ name: 'Z' });
  assert.equal(r.status, 403);
});

test('import Excel 43 anggota, lalu import ulang dilewati', async () => {
  const file = path.join(__dirname, '..', 'data', 'Pengurus_OSIS_2026-2027.xlsx');
  const dry = await agents.admin.post('/api/import/members?dryRun=1').set(H).attach('file', file);
  assert.equal(dry.status, 200, JSON.stringify(dry.body));
  assert.equal(dry.body.created.length, 43);
  let s = await request(app).get('/api/summary');
  assert.equal(s.body.members.length, 0, 'dry run tidak menyimpan');
  const real = await agents.admin.post('/api/import/members').set(H).attach('file', file);
  assert.equal(real.body.created.length, 43);
  s = await request(app).get('/api/summary');
  assert.equal(s.body.members.length, 43);
  assert.equal(s.body.members.filter((m) => m.kelas === 'X').length, 24);
  const again = await agents.admin.post('/api/import/members').set(H).attach('file', file);
  assert.equal(again.body.created.length, 0);
  assert.equal(again.body.skipped.length, 43);
});

test('tambah/kurang poin tercatat di riwayat, lalu reset', async () => {
  const s = await request(app).get('/api/summary');
  const m = s.body.members[0];
  let r = await agents.admin.post(`/api/members/${m.id}/points`).set(H).send({ delta: 15, reason: 'Panitia MPLS' });
  assert.equal(r.body.points, 15);
  r = await agents.admin.post(`/api/members/${m.id}/points`).set(H).send({ delta: -5, reason: 'Terlambat rapat' });
  assert.equal(r.body.points, 10);
  const h = await request(app).get(`/api/history?member=${m.id}`);
  assert.equal(h.body.history[0].points_after, 10);
  assert.equal(h.body.history[0].delta, -5);
  r = await agents.admin.post('/api/members/reset-points').set(H).send({ confirm: 'RESET', password: 'salah' });
  assert.equal(r.status, 400);
  r = await agents.admin.post('/api/members/reset-points').set(H).send({ confirm: 'RESET', password: 'admin-test-123' });
  assert.equal(r.body.affected, 1);
  const s2 = await request(app).get('/api/summary');
  assert.ok(s2.body.members.every((x) => x.points === 0));
});

test('divisi, proker, anggota: tambah & hapus', async () => {
  const d = await agents.admin.post('/api/divisions').set(H).send({ name: 'Divisi Uji' });
  assert.equal(d.status, 201);
  const dup = await agents.admin.post('/api/divisions').set(H).send({ name: 'Divisi Uji' });
  assert.equal(dup.status, 409);
  const p = await agents.admin.post('/api/programs').set(H).send({ divisionId: d.body.id, name: 'Proker Uji' });
  assert.equal(p.status, 201);
  const m = await agents.admin.post('/api/members').set(H).send({ name: 'Anggota Uji', kelas: 'XI', divisionId: d.body.id, jabatan: 'Ketua Divisi', points: 3 });
  assert.equal(m.status, 201);
  assert.equal((await agents.admin.delete(`/api/programs/${p.body.id}`).set(H)).status, 200);
  assert.equal((await agents.admin.delete(`/api/divisions/${d.body.id}`).set(H)).status, 200);
  const s = await request(app).get('/api/summary');
  assert.equal(s.body.members.find((x) => x.id === m.body.id).division_id, null);
  assert.equal((await agents.admin.delete(`/api/members/${m.body.id}`).set(H)).status, 200);
});

test('pelanggaran: minimal 2 saksi, approval, pengurangan poin, surat', async () => {
  const s = await request(app).get('/api/summary');
  const [t, w1, w2] = s.body.members;
  const base = { memberId: t.id, jenis: 'Tidak hadir rapat tanpa izin', points: 10, incidentDate: '2026-11-02', location: 'Ruang OSIS' };
  let r = await agents.admin.post('/api/violations').set(H).send({ ...base, witnesses: [{ memberId: w1.id }] });
  assert.equal(r.status, 400);
  r = await agents.admin.post('/api/violations').set(H).send({ ...base, witnesses: [{ memberId: w1.id }, { memberId: w1.id }] });
  assert.equal(r.status, 400, 'saksi duplikat tidak dihitung dua kali');
  r = await agents.admin.post('/api/violations').set(H).send({ ...base, witnesses: [{ memberId: t.id }, { memberId: w1.id }] });
  assert.equal(r.status, 400, 'terlapor tidak boleh jadi saksi');
  r = await agents.ketua.post('/api/violations').set(H).send({ ...base, witnesses: [{ memberId: w1.id }, { name: 'Bu Sri', info: 'Guru BK' }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const vid = r.body.id;
  let s2 = await request(app).get('/api/summary');
  assert.equal(s2.body.members.find((x) => x.id === t.id).points, 0, 'belum dikurangi sebelum approval');
  assert.equal((await agents.admin.post(`/api/violations/${vid}/decision`).set(H).send({ decision: 'approve' })).status, 403, 'admin bukan approver');
  assert.equal((await agents.ketua.post(`/api/violations/${vid}/decision`).set(H).send({ decision: 'approve' })).status, 403, 'pelapor tidak boleh approve sendiri');
  r = await agents.pembina.post(`/api/violations/${vid}/decision`).set(H).send({ decision: 'approve', note: 'Sesuai' });
  assert.equal(r.body.status, 'approved');
  assert.match(r.body.letterNumber, /^001\/SKP\/OSIS\/[IVX]+\/\d{4}$/);
  s2 = await request(app).get('/api/summary');
  assert.equal(s2.body.members.find((x) => x.id === t.id).points, -10);
  assert.equal((await agents.calon.post(`/api/violations/${vid}/decision`).set(H).send({ decision: 'approve' })).status, 409);
  const detail = await agents.admin.get(`/api/violations/${vid}`);
  assert.equal(detail.body.witnesses.length, 2);
  assert.equal(detail.body.approvals.length, 1);
  assert.equal((await agents.admin.delete(`/api/violations/${vid}`).set(H)).status, 409);

  r = await agents.admin.post('/api/violations').set(H).send({ ...base, witnesses: [{ memberId: w1.id }, { memberId: w2.id }] });
  const rej = await agents.calon.post(`/api/violations/${r.body.id}/decision`).set(H).send({ decision: 'reject' });
  assert.equal(rej.status, 400, 'tolak wajib alasan');
  const rej2 = await agents.calon.post(`/api/violations/${r.body.id}/decision`).set(H).send({ decision: 'reject', note: 'Bukti kurang' });
  assert.equal(rej2.body.status, 'rejected');
  s2 = await request(app).get('/api/summary');
  assert.equal(s2.body.members.find((x) => x.id === t.id).points, -10);
});

test('manajemen barang: stok, peminjaman, pengembalian', async () => {
  assert.equal((await agents.pembina.post('/api/items').set(H).send({ name: 'Proyektor', quantity: 2 })).status, 403);
  let r = await agents.admin.post('/api/items').set(H).send({ name: 'Proyektor', category: 'Elektronik', quantity: 2, unit: 'unit', location: 'Ruang OSIS' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const itemId = r.body.id;
  const s = await request(app).get('/api/summary');
  const m = s.body.members[0];
  assert.equal((await request(app).post('/api/loans').set(H).send({ itemId, quantity: 1, memberId: m.id })).status, 401);
  r = await agents.ketua.post('/api/loans').set(H).send({ itemId, quantity: 3, memberId: m.id });
  assert.equal(r.status, 400, 'melebihi stok');
  r = await agents.ketua.post('/api/loans').set(H).send({ itemId, quantity: 2, memberId: m.id, purpose: 'Rapat pleno' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const loanId = r.body.id;
  let list = await request(app).get('/api/items');
  assert.equal(list.body.items[0].borrowed, 2);
  assert.equal(list.body.activeLoans.length, 1);
  assert.equal((await agents.admin.put(`/api/items/${itemId}`).set(H).send({ name: 'Proyektor', quantity: 1 })).status, 400);
  assert.equal((await agents.admin.delete(`/api/items/${itemId}`).set(H)).status, 400);
  r = await agents.pembina.post(`/api/loans/${loanId}/return`).set(H).send({ condition: 'rusak_ringan', note: 'Kabel longgar' });
  assert.equal(r.status, 200);
  assert.equal((await agents.pembina.post(`/api/loans/${loanId}/return`).set(H).send({})).status, 400);
  list = await request(app).get('/api/items');
  assert.equal(list.body.items[0].borrowed, 0);
  assert.equal(list.body.returnedLoans[0].return_condition, 'rusak_ringan');
  r = await agents.ketua.post('/api/loans').set(H).send({ itemId, quantity: 1, borrowerName: 'Pak Budi' });
  assert.equal(r.status, 201);
  assert.equal((await agents.admin.delete(`/api/loans/${r.body.id}`).set(H)).status, 200);
  assert.equal((await agents.admin.delete(`/api/items/${itemId}`).set(H)).status, 200);
});

test('sistem piket: jadwal & absensi', async () => {
  const s = await request(app).get('/api/summary');
  const [a, b] = s.body.members;
  assert.equal((await agents.ketua.post('/api/piket').set(H).send({ day: 1, memberId: a.id })).status, 403);
  let r = await agents.admin.post('/api/piket').set(H).send({ day: 1, memberId: a.id, task: 'Sapu ruang OSIS' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await agents.admin.post('/api/piket').set(H).send({ day: 1, memberId: a.id })).status, 409);
  assert.equal((await agents.admin.post('/api/piket').set(H).send({ day: 7, memberId: a.id })).status, 400);
  await agents.admin.post('/api/piket').set(H).send({ day: 1, memberId: b.id });
  const sched = await request(app).get('/api/piket');
  assert.equal(sched.body.schedule.length, 2);
  // 2026-11-09 adalah hari Senin.
  let att = await request(app).get('/api/piket/attendance?date=2026-11-09');
  assert.equal(att.body.dayName, 'Senin');
  assert.equal(att.body.records.length, 2);
  assert.equal((await request(app).put('/api/piket/attendance').set(H).send({ date: '2026-11-09', records: [{ memberId: a.id, status: 'hadir' }] })).status, 401);
  r = await agents.ketua.put('/api/piket/attendance').set(H).send({ date: '2026-11-09', records: [{ memberId: a.id, status: 'hadir' }, { memberId: b.id, status: 'alpa', note: 'Tanpa kabar' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  att = await request(app).get('/api/piket/attendance?date=2026-11-09');
  assert.equal(att.body.records.find((x) => x.member_id === b.id).attendance.status, 'alpa');
  const recap = await request(app).get('/api/piket/recap?from=2026-11-01&to=2026-11-30');
  assert.equal(recap.body.recap.find((x) => x.member_id === a.id).hadir, 1);
  assert.equal((await agents.ketua.put('/api/piket/attendance').set(H).send({ date: '2999-01-01', records: [{ memberId: a.id, status: 'hadir' }] })).status, 400);
  assert.equal((await agents.admin.delete(`/api/piket/${sched.body.schedule[0].id}`).set(H)).status, 200);
});

test('ganti password membatalkan sesi lama', async () => {
  const a = await login('calon', 'password-123');
  const old = await login('calon', 'password-123');
  const r = await a.post('/api/auth/password').set(H).send({ oldPassword: 'password-123', newPassword: 'password-baru-1' });
  assert.equal(r.status, 200);
  const me = await old.get('/api/auth/me');
  assert.equal(me.body.user, null);
  const me2 = await a.get('/api/auth/me');
  assert.equal(me2.body.user.username, 'calon');
});
