const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query, tx } = require('../db');
const { requireAdmin, ROLES, ROLE_LABEL } = require('../auth');
const { wrap, parseBody, idParam, HttpError, logHistory } = require('../util');

const router = express.Router();
const actor = (req) => `${req.user.display_name} (${ROLE_LABEL[req.user.role]})`;
const name = (label, max = 120) => z.string().trim().min(1, `${label} wajib diisi`).max(max, `${label} terlalu panjang`);
const int = (label) => z.coerce.number({ message: `${label} harus angka` }).int(`${label} harus bilangan bulat`)
  .min(-100000).max(100000);

const MEMBER_SELECT = `
  SELECT m.id, m.name, m.kelas, m.jabatan, m.points, m.division_id, d.name AS division
  FROM members m LEFT JOIN divisions d ON d.id = m.division_id`;

/* ---------------- Baca (publik, read-only) ---------------- */

router.get('/summary', wrap(async (_req, res) => {
  const [members, divisions, programs] = await Promise.all([
    query(`${MEMBER_SELECT} ORDER BY m.points DESC, m.name ASC`),
    query(`SELECT d.id, d.name, count(m.id)::int AS member_count,
             COALESCE(sum(m.points),0)::int AS total_points
           FROM divisions d LEFT JOIN members m ON m.division_id = d.id
           GROUP BY d.id ORDER BY d.id`),
    query('SELECT id, division_id, name, created_at FROM programs ORDER BY created_at'),
  ]);
  res.json({ members: members.rows, divisions: divisions.rows, programs: programs.rows });
}));

router.get('/history', wrap(async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  const params = [limit];
  let where = '';
  if (req.query.member) { params.push(idParam(req.query.member)); where = 'WHERE member_id = $2'; }
  const { rows } = await query(
    `SELECT id, action, description, member_id, member_name, delta, points_before, points_after, actor_name, created_at
     FROM history ${where} ORDER BY created_at DESC, id DESC LIMIT $1`, params);
  res.json({ history: rows });
}));

/* ---------------- Divisi ---------------- */

router.post('/divisions', requireAdmin, wrap(async (req, res) => {
  const body = parseBody(z.object({ name: name('Nama divisi', 80) }), req.body);
  const out = await tx(async (db) => {
    const { rows } = await db.query(
      'INSERT INTO divisions (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *', [body.name]);
    if (!rows[0]) throw new HttpError(409, 'Divisi dengan nama tersebut sudah ada.');
    await logHistory(db, { action: 'divisi_tambah', description: `Menambahkan divisi "${body.name}"`, actor: actor(req) });
    return rows[0];
  });
  res.status(201).json(out);
}));

router.delete('/divisions/:id', requireAdmin, wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await tx(async (db) => {
    const { rows } = await db.query('DELETE FROM divisions WHERE id=$1 RETURNING name', [id]);
    if (!rows[0]) throw new HttpError(404, 'Divisi tidak ditemukan.');
    await logHistory(db, { action: 'divisi_hapus', description: `Menghapus divisi "${rows[0].name}" (anggota dipindah ke "Tanpa Divisi", proker ikut terhapus)`, actor: actor(req) });
  });
  res.json({ ok: true });
}));

/* ---------------- Program kerja ---------------- */

router.post('/programs', requireAdmin, wrap(async (req, res) => {
  const body = parseBody(z.object({ divisionId: z.coerce.number().int().positive('Pilih divisi'), name: name('Nama proker', 200) }), req.body);
  const out = await tx(async (db) => {
    const d = await db.query('SELECT name FROM divisions WHERE id=$1', [body.divisionId]);
    if (!d.rows[0]) throw new HttpError(404, 'Divisi tidak ditemukan.');
    const { rows } = await db.query('INSERT INTO programs (division_id, name) VALUES ($1,$2) RETURNING *', [body.divisionId, body.name]);
    await logHistory(db, { action: 'proker_tambah', description: `Menambahkan proker "${body.name}" di ${d.rows[0].name}`, actor: actor(req) });
    return rows[0];
  });
  res.status(201).json(out);
}));

router.delete('/programs/:id', requireAdmin, wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await tx(async (db) => {
    const { rows } = await db.query(
      `DELETE FROM programs p USING divisions d WHERE p.id=$1 AND d.id=p.division_id RETURNING p.name, d.name AS division`, [id]);
    if (!rows[0]) throw new HttpError(404, 'Proker tidak ditemukan.');
    await logHistory(db, { action: 'proker_hapus', description: `Menghapus proker "${rows[0].name}" dari ${rows[0].division}`, actor: actor(req) });
  });
  res.json({ ok: true });
}));

/* ---------------- Anggota ---------------- */

const memberSchema = z.object({
  name: name('Nama', 120),
  kelas: z.string().trim().max(20).default(''),
  divisionId: z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional()
    .transform((v) => (v ? Number(v) : null)),
  jabatan: z.string().trim().max(60).default('Anggota').transform((v) => v || 'Anggota'),
});

router.post('/members', requireAdmin, wrap(async (req, res) => {
  const body = parseBody(memberSchema.extend({ points: int('Poin').default(0) }), req.body);
  const out = await tx(async (db) => {
    let r;
    try {
      r = await db.query(
        'INSERT INTO members (name, kelas, division_id, jabatan, points) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [body.name, body.kelas, body.divisionId, body.jabatan, body.points]);
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'Anggota dengan nama dan kelas yang sama sudah ada.');
      if (e.code === '23503') throw new HttpError(400, 'Divisi tidak ditemukan.');
      throw e;
    }
    const m = r.rows[0];
    await logHistory(db, { action: 'anggota_tambah', description: `Menambahkan anggota "${m.name}" dengan poin awal ${m.points}`, memberId: m.id, memberName: m.name, delta: m.points, before: 0, after: m.points, actor: actor(req) });
    return m;
  });
  res.status(201).json(out);
}));

router.put('/members/:id', requireAdmin, wrap(async (req, res) => {
  const id = idParam(req.params.id);
  const body = parseBody(memberSchema, req.body);
  const out = await tx(async (db) => {
    let r;
    try {
      r = await db.query('UPDATE members SET name=$1, kelas=$2, division_id=$3, jabatan=$4 WHERE id=$5 RETURNING *',
        [body.name, body.kelas, body.divisionId, body.jabatan, id]);
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'Anggota dengan nama dan kelas yang sama sudah ada.');
      if (e.code === '23503') throw new HttpError(400, 'Divisi tidak ditemukan.');
      throw e;
    }
    if (!r.rows[0]) throw new HttpError(404, 'Anggota tidak ditemukan.');
    await logHistory(db, { action: 'anggota_ubah', description: `Memperbarui data anggota "${body.name}"`, memberId: id, memberName: body.name, actor: actor(req) });
    return r.rows[0];
  });
  res.json(out);
}));

router.delete('/members/:id', requireAdmin, wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await tx(async (db) => {
    const { rows } = await db.query('DELETE FROM members WHERE id=$1 RETURNING name, points', [id]);
    if (!rows[0]) throw new HttpError(404, 'Anggota tidak ditemukan.');
    await logHistory(db, { action: 'anggota_hapus', description: `Menghapus anggota "${rows[0].name}" (poin terakhir ${rows[0].points})`, memberName: rows[0].name, actor: actor(req) });
  });
  res.json({ ok: true });
}));

// Tambah / kurangi poin. Semua perubahan tercatat di riwayat.
router.post('/members/:id/points', requireAdmin, wrap(async (req, res) => {
  const id = idParam(req.params.id);
  const body = parseBody(z.object({
    delta: int('Jumlah poin').refine((v) => v !== 0, 'Jumlah poin tidak boleh 0'),
    reason: name('Alasan', 300),
  }), req.body);
  const out = await tx(async (db) => {
    const cur = await db.query('SELECT * FROM members WHERE id=$1 FOR UPDATE', [id]);
    const m = cur.rows[0];
    if (!m) throw new HttpError(404, 'Anggota tidak ditemukan.');
    const after = m.points + body.delta;
    await db.query('UPDATE members SET points=$1 WHERE id=$2', [after, id]);
    await logHistory(db, {
      action: body.delta > 0 ? 'poin_tambah' : 'poin_kurang',
      description: `${body.delta > 0 ? 'Penambahan' : 'Pengurangan'} ${Math.abs(body.delta)} poin: ${body.reason}`,
      memberId: id, memberName: m.name, delta: body.delta, before: m.points, after, actor: actor(req),
    });
    return { ...m, points: after };
  });
  res.json(out);
}));

// Reset seluruh poin anggota menjadi 0. Wajib konfirmasi teks "RESET" + password admin.
router.post('/members/reset-points', requireAdmin, wrap(async (req, res) => {
  const body = parseBody(z.object({ confirm: z.literal('RESET', { message: 'Ketik RESET untuk konfirmasi' }), password: z.string().min(1, 'Password wajib diisi') }), req.body);
  const u = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(body.password, u.rows[0].password_hash))) throw new HttpError(400, 'Password salah.');
  const count = await tx(async (db) => {
    const { rows } = await db.query('SELECT id, name, points FROM members WHERE points <> 0 FOR UPDATE');
    for (const m of rows) {
      await logHistory(db, { action: 'poin_reset', description: 'Reset poin (reset keseluruhan)', memberId: m.id, memberName: m.name, delta: -m.points, before: m.points, after: 0, actor: actor(req) });
    }
    await db.query('UPDATE members SET points = 0');
    await logHistory(db, { action: 'reset_semua', description: `Reset keseluruhan poin anggota (${rows.length} anggota terdampak)`, actor: actor(req) });
    return rows.length;
  });
  res.json({ ok: true, affected: count });
}));

/* ---------------- Akun pengelola (admin, pembina, ketua, calon ketua) ---------------- */

router.get('/users', requireAdmin, wrap(async (_req, res) => {
  const { rows } = await query('SELECT id, username, display_name AS name, role, created_at FROM users ORDER BY id');
  res.json({ users: rows.map((u) => ({ ...u, roleLabel: ROLE_LABEL[u.role] })) });
}));

router.post('/users', requireAdmin, wrap(async (req, res) => {
  const body = parseBody(z.object({
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/, 'Username 3-32 karakter (huruf kecil, angka, titik, minus, garis bawah)'),
    name: name('Nama', 120),
    role: z.enum(ROLES, { message: 'Peran tidak valid' }),
    password: z.string().min(8, 'Password minimal 8 karakter').max(200),
  }), req.body);
  const hash = await bcrypt.hash(body.password, 12);
  const out = await tx(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO users (username, display_name, password_hash, role) VALUES ($1,$2,$3,$4)
       ON CONFLICT (username) DO NOTHING RETURNING id, username, display_name AS name, role`,
      [body.username, body.name, hash, body.role]);
    if (!rows[0]) throw new HttpError(409, 'Username sudah dipakai.');
    await logHistory(db, { action: 'akun_tambah', description: `Membuat akun ${ROLE_LABEL[body.role]} "${body.name}"`, actor: actor(req) });
    return rows[0];
  });
  res.status(201).json(out);
}));

router.delete('/users/:id', requireAdmin, wrap(async (req, res) => {
  const id = idParam(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'Tidak bisa menghapus akun sendiri.');
  await tx(async (db) => {
    const { rows } = await db.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [id]);
    if (!rows[0]) throw new HttpError(404, 'Akun tidak ditemukan.');
    if (rows[0].role === 'admin') {
      const { rows: c } = await db.query("SELECT count(*)::int AS n FROM users WHERE role='admin'");
      if (c[0].n <= 1) throw new HttpError(400, 'Minimal harus ada satu admin.');
    }
    await db.query('DELETE FROM users WHERE id=$1', [id]);
    await logHistory(db, { action: 'akun_hapus', description: `Menghapus akun ${ROLE_LABEL[rows[0].role]} "${rows[0].display_name}"`, actor: actor(req) });
  });
  res.json({ ok: true });
}));

module.exports = router;
