// Sistem piket: jadwal piket mingguan (Senin-Sabtu) & absensi piket harian.
const express = require('express');
const { z } = require('zod');
const { query, tx } = require('../db');
const { requireAdmin, requireAuth, ROLE_LABEL } = require('../auth');
const { wrap, parseBody, idParam, HttpError, logHistory } = require('../util');

const router = express.Router();
const actor = (req) => `${req.user.display_name} (${ROLE_LABEL[req.user.role]})`;
const DAYS = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const STATUSES = ['hadir', 'izin', 'sakit', 'alpa'];
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal tidak valid')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Tanggal tidak valid');
// Hari dalam minggu (1=Senin ... 7=Minggu) dari string YYYY-MM-DD, tanpa terpengaruh zona waktu server.
const isoDay = (s) => { const d = new Date(`${s}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };

const SCHEDULE_SELECT = `
  SELECT s.id, s.day, s.member_id, s.task, m.name AS member_name, m.kelas, d.name AS division
  FROM piket_schedule s JOIN members m ON m.id = s.member_id LEFT JOIN divisions d ON d.id = m.division_id`;

router.get('/piket', wrap(async (_req, res) => {
  const { rows } = await query(`${SCHEDULE_SELECT} ORDER BY s.day, lower(m.name)`);
  res.json({ schedule: rows });
}));

router.post('/piket', requireAdmin, wrap(async (req, res) => {
  const b = parseBody(z.object({
    day: z.coerce.number().int().min(1, 'Hari tidak valid').max(6, 'Hari tidak valid'),
    memberId: z.coerce.number().int().positive('Pilih anggota'),
    task: z.string().trim().max(120, 'Tugas terlalu panjang').default(''),
  }), req.body);
  const out = await tx(async (db) => {
    const m = await db.query('SELECT name FROM members WHERE id=$1', [b.memberId]);
    if (!m.rows[0]) throw new HttpError(404, 'Anggota tidak ditemukan.');
    const { rows } = await db.query(
      'INSERT INTO piket_schedule (day, member_id, task) VALUES ($1,$2,$3) ON CONFLICT (day, member_id) DO NOTHING RETURNING *',
      [b.day, b.memberId, b.task]);
    if (!rows[0]) throw new HttpError(409, `${m.rows[0].name} sudah terjadwal piket hari ${DAYS[b.day]}.`);
    await logHistory(db, { action: 'piket_jadwal', description: `Menjadwalkan ${m.rows[0].name} piket hari ${DAYS[b.day]}${b.task ? ` (${b.task})` : ''}`, memberId: b.memberId, memberName: m.rows[0].name, actor: actor(req) });
    return rows[0];
  });
  res.status(201).json(out);
}));

router.delete('/piket/:id', requireAdmin, wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await tx(async (db) => {
    const { rows } = await db.query(
      `DELETE FROM piket_schedule s USING members m WHERE s.id=$1 AND m.id=s.member_id RETURNING s.day, s.member_id, m.name`, [id]);
    if (!rows[0]) throw new HttpError(404, 'Jadwal piket tidak ditemukan.');
    await logHistory(db, { action: 'piket_jadwal_hapus', description: `Menghapus ${rows[0].name} dari jadwal piket hari ${DAYS[rows[0].day]}`, memberId: rows[0].member_id, memberName: rows[0].name, actor: actor(req) });
  });
  res.json({ ok: true });
}));

/* ---------------- Absensi piket ---------------- */

// Daftar petugas piket pada tanggal tertentu (sesuai jadwal hari itu) beserta status absensinya.
router.get('/piket/attendance', wrap(async (req, res) => {
  const date = parseBody(z.object({ date: dateStr }), req.query).date;
  const day = isoDay(date);
  const [sched, att] = await Promise.all([
    query(`${SCHEDULE_SELECT} WHERE s.day=$1 ORDER BY lower(m.name)`, [day]),
    query(`SELECT member_id, member_name, status, note, recorded_by, updated_at FROM piket_attendance WHERE date=$1 ORDER BY lower(member_name)`, [date]),
  ]);
  const byMember = new Map(att.rows.map((a) => [a.member_id, a]));
  const records = sched.rows.map((s) => ({ ...s, attendance: byMember.get(s.member_id) || null }));
  // Absensi yang tercatat untuk anggota yang kini tidak lagi terjadwal di hari tersebut tetap ditampilkan.
  const scheduled = new Set(sched.rows.map((s) => s.member_id));
  const extra = att.rows.filter((a) => !scheduled.has(a.member_id))
    .map((a) => ({ id: null, day, member_id: a.member_id, member_name: a.member_name, kelas: '', division: null, task: '', attendance: a }));
  res.json({ date, day, dayName: DAYS[day] || 'Minggu', records: [...records, ...extra] });
}));

// Rekap absensi piket per anggota dalam rentang tanggal (default 30 hari terakhir).
router.get('/piket/recap', wrap(async (req, res) => {
  const q = parseBody(z.object({ from: dateStr, to: dateStr }), req.query);
  if (q.from > q.to) throw new HttpError(400, 'Rentang tanggal tidak valid.');
  const { rows } = await query(
    `SELECT a.member_id, max(a.member_name) AS member_name,
            count(*) FILTER (WHERE status='hadir')::int AS hadir,
            count(*) FILTER (WHERE status='izin')::int AS izin,
            count(*) FILTER (WHERE status='sakit')::int AS sakit,
            count(*) FILTER (WHERE status='alpa')::int AS alpa
     FROM piket_attendance a WHERE date BETWEEN $1 AND $2
     GROUP BY a.member_id ORDER BY lower(max(a.member_name))`, [q.from, q.to]);
  res.json({ from: q.from, to: q.to, recap: rows });
}));

router.put('/piket/attendance', requireAuth, wrap(async (req, res) => {
  const b = parseBody(z.object({
    date: dateStr,
    records: z.array(z.object({
      memberId: z.coerce.number().int().positive(),
      status: z.enum([...STATUSES, ''], { message: 'Status absensi tidak valid' }),
      note: z.string().trim().max(200, 'Catatan terlalu panjang').default(''),
    })).min(1, 'Tidak ada data absensi').max(200),
  }), req.body);
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); // WIB
  if (b.date > today) throw new HttpError(400, 'Tidak bisa mengisi absensi untuk tanggal yang akan datang.');
  const saved = await tx(async (db) => {
    const ids = b.records.map((r) => r.memberId);
    const { rows: members } = await db.query('SELECT id, name FROM members WHERE id = ANY($1)', [ids]);
    const names = new Map(members.map((m) => [m.id, m.name]));
    const counts = { hadir: 0, izin: 0, sakit: 0, alpa: 0 };
    let n = 0;
    for (const r of b.records) {
      if (!names.has(r.memberId)) continue;
      if (!r.status) {
        await db.query('DELETE FROM piket_attendance WHERE date=$1 AND member_id=$2', [b.date, r.memberId]);
        continue;
      }
      await db.query(
        `INSERT INTO piket_attendance (date, member_id, member_name, status, note, recorded_by) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (date, member_id) DO UPDATE SET status=EXCLUDED.status, note=EXCLUDED.note,
           member_name=EXCLUDED.member_name, recorded_by=EXCLUDED.recorded_by, updated_at=now()`,
        [b.date, r.memberId, names.get(r.memberId), r.status, r.note, actor(req)]);
      counts[r.status] += 1; n += 1;
    }
    const summary = STATUSES.filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`).join(', ') || 'dikosongkan';
    await logHistory(db, { action: 'piket_absen', description: `Absensi piket ${DAYS[isoDay(b.date)] || 'Minggu'}, ${b.date}: ${summary}`, actor: actor(req) });
    return n;
  });
  res.json({ ok: true, saved });
}));

module.exports = router;
