const express = require('express');
const { z } = require('zod');
const { query, tx } = require('../db');
const config = require('../config');
const { requireAuth, requireAdmin, requireRole, APPROVER_ROLES, ROLE_LABEL } = require('../auth');
const { wrap, parseBody, idParam, HttpError, logHistory } = require('../util');

const router = express.Router();
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const actorOf = (u) => `${u.display_name} (${ROLE_LABEL[u.role]})`;

async function loadViolations(db, where = '', params = []) {
  const { rows } = await db.query(`SELECT * FROM violations ${where} ORDER BY created_at DESC, id DESC`, params);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [w, a] = await Promise.all([
    db.query('SELECT violation_id, member_id, name, info FROM violation_witnesses WHERE violation_id = ANY($1) ORDER BY id', [ids]),
    db.query('SELECT violation_id, user_id, user_name, user_role, decision, note, created_at FROM violation_approvals WHERE violation_id = ANY($1) ORDER BY created_at', [ids]),
  ]);
  return rows.map((v) => ({
    ...v,
    witnesses: w.rows.filter((x) => x.violation_id === v.id),
    approvals: a.rows.filter((x) => x.violation_id === v.id).map((x) => ({ ...x, roleLabel: ROLE_LABEL[x.user_role] })),
  }));
}

router.get('/violations/config', requireAuth, (_req, res) => {
  res.json({ requiredApprovals: config.requiredApprovals, minWitnesses: config.minWitnesses, approverRoles: APPROVER_ROLES.map((r) => ({ role: r, label: ROLE_LABEL[r] })) });
});

router.get('/violations', requireAuth, wrap(async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
  const list = await loadViolations({ query }, status ? 'WHERE status=$1' : '', status ? [status] : []);
  res.json({ violations: list, requiredApprovals: config.requiredApprovals });
}));

router.get('/violations/:id', requireAuth, wrap(async (req, res) => {
  const [v] = await loadViolations({ query }, 'WHERE id=$1', [idParam(req.params.id)]);
  if (!v) throw new HttpError(404, 'Laporan tidak ditemukan.');
  res.json({ ...v, requiredApprovals: config.requiredApprovals, schoolName: config.schoolName });
}));

const witnessSchema = z.object({
  memberId: z.union([z.coerce.number().int().positive(), z.null(), z.literal('')]).optional().transform((v) => (v ? Number(v) : null)),
  name: z.string().trim().max(120).optional().default(''),
  info: z.string().trim().max(120).optional().default(''),
});

// Semua akun pengelola (admin, pembina, ketua, calon ketua) bisa membuat laporan.
router.post('/violations', requireAuth, wrap(async (req, res) => {
  const body = parseBody(z.object({
    memberId: z.coerce.number().int().positive('Pilih anggota yang melanggar'),
    jenis: z.string().trim().min(1, 'Jenis pelanggaran wajib diisi').max(200),
    description: z.string().trim().max(2000).default(''),
    points: z.coerce.number().int('Poin harus bilangan bulat').min(1, 'Poin pelanggaran minimal 1').max(1000),
    incidentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal kejadian tidak valid'),
    location: z.string().trim().max(200).default(''),
    witnesses: z.array(witnessSchema).max(20),
  }), req.body);

  const out = await tx(async (db) => {
    const m = (await db.query(`SELECT m.*, d.name AS division FROM members m LEFT JOIN divisions d ON d.id=m.division_id WHERE m.id=$1`, [body.memberId])).rows[0];
    if (!m) throw new HttpError(404, 'Anggota tidak ditemukan.');

    // Normalisasi saksi: dari daftar anggota atau nama manual (mis. guru/siswa non-pengurus).
    const witnesses = [];
    const keys = new Set();
    for (const w of body.witnesses) {
      let name = w.name; let memberId = null;
      if (w.memberId) {
        if (w.memberId === m.id) throw new HttpError(400, 'Terlapor tidak boleh menjadi saksi.');
        const wm = (await db.query('SELECT id, name, kelas FROM members WHERE id=$1', [w.memberId])).rows[0];
        if (!wm) throw new HttpError(400, 'Saksi tidak ditemukan di daftar anggota.');
        name = wm.name; memberId = wm.id;
        if (!w.info && wm.kelas) w.info = `Kelas ${wm.kelas}`;
      }
      if (!name) continue;
      const key = memberId ? `m${memberId}` : `n${name.toLowerCase()}`;
      if (keys.has(key) || (!memberId && name.toLowerCase() === m.name.toLowerCase())) continue;
      keys.add(key);
      witnesses.push({ memberId, name, info: w.info });
    }
    if (witnesses.length < config.minWitnesses) throw new HttpError(400, `Laporan wajib memiliki minimal ${config.minWitnesses} saksi yang berbeda.`);

    const v = (await db.query(
      `INSERT INTO violations (member_id, member_name, member_kelas, member_division, jenis, description, points, incident_date, location, reported_by, reporter_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [m.id, m.name, m.kelas, m.division, body.jenis, body.description, body.points, body.incidentDate, body.location, req.user.id, actorOf(req.user)])).rows[0];
    for (const w of witnesses) {
      await db.query('INSERT INTO violation_witnesses (violation_id, member_id, name, info) VALUES ($1,$2,$3,$4)', [v.id, w.memberId, w.name, w.info]);
    }
    await logHistory(db, { action: 'pelanggaran_lapor', description: `Laporan pelanggaran #${v.id} "${body.jenis}" (${body.points} poin) menunggu persetujuan`, memberId: m.id, memberName: m.name, actor: actorOf(req.user) });
    return v;
  });
  res.status(201).json(out);
}));

// Persetujuan oleh Pembina / Ketua / Calon Ketua OSIS. Poin baru dikurangi setelah disetujui.
router.post('/violations/:id/decision', requireRole(...APPROVER_ROLES), wrap(async (req, res) => {
  const id = idParam(req.params.id);
  const body = parseBody(z.object({
    decision: z.enum(['approve', 'reject']),
    note: z.string().trim().max(500).default(''),
  }), req.body);
  if (body.decision === 'reject' && !body.note) throw new HttpError(400, 'Alasan penolakan wajib diisi.');

  const out = await tx(async (db) => {
    const v = (await db.query('SELECT * FROM violations WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!v) throw new HttpError(404, 'Laporan tidak ditemukan.');
    if (v.status !== 'pending') throw new HttpError(409, 'Laporan ini sudah diputuskan.');
    if (v.reported_by === req.user.id) throw new HttpError(403, 'Pelapor tidak boleh menyetujui laporannya sendiri.');
    const ins = await db.query(
      `INSERT INTO violation_approvals (violation_id, user_id, user_name, user_role, decision, note) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (violation_id, user_id) DO NOTHING RETURNING id`,
      [id, req.user.id, req.user.display_name, req.user.role, body.decision, body.note]);
    if (!ins.rows[0]) throw new HttpError(409, 'Anda sudah memberikan keputusan untuk laporan ini.');
    const actor = actorOf(req.user);

    if (body.decision === 'reject') {
      await db.query("UPDATE violations SET status='rejected', decided_at=now() WHERE id=$1", [id]);
      await logHistory(db, { action: 'pelanggaran_tolak', description: `Laporan pelanggaran #${id} "${v.jenis}" ditolak: ${body.note}`, memberId: v.member_id, memberName: v.member_name, actor });
      return { status: 'rejected' };
    }

    const { rows: c } = await db.query("SELECT count(*)::int AS n FROM violation_approvals WHERE violation_id=$1 AND decision='approve'", [id]);
    if (c[0].n < config.requiredApprovals) {
      await logHistory(db, { action: 'pelanggaran_setuju', description: `Persetujuan ${c[0].n}/${config.requiredApprovals} untuk laporan pelanggaran #${id}`, memberId: v.member_id, memberName: v.member_name, actor });
      return { status: 'pending', approvals: c[0].n };
    }

    // Disahkan: kurangi poin + terbitkan nomor surat.
    await db.query('SELECT pg_advisory_xact_lock(424242)');
    const now = new Date();
    const year = now.getFullYear();
    const { rows: seq } = await db.query(
      "SELECT count(*)::int AS n FROM violations WHERE letter_number IS NOT NULL AND date_part('year', decided_at) = $1", [year]);
    const letter = `${String(seq[0].n + 1).padStart(3, '0')}/SKP/OSIS/${ROMAN[now.getMonth()]}/${year}`;
    await db.query("UPDATE violations SET status='approved', decided_at=now(), letter_number=$1 WHERE id=$2", [letter, id]);
    if (v.member_id) {
      const m = (await db.query('SELECT points FROM members WHERE id=$1 FOR UPDATE', [v.member_id])).rows[0];
      if (m) {
        const after = m.points - v.points;
        await db.query('UPDATE members SET points=$1 WHERE id=$2', [after, v.member_id]);
        await logHistory(db, { action: 'pelanggaran', description: `Pengurangan ${v.points} poin karena pelanggaran: ${v.jenis} (Surat No. ${letter})`, memberId: v.member_id, memberName: v.member_name, delta: -v.points, before: m.points, after, actor });
      }
    }
    return { status: 'approved', letterNumber: letter };
  });
  res.json(out);
}));

router.delete('/violations/:id', requireAdmin, wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await tx(async (db) => {
    const v = (await db.query('SELECT * FROM violations WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!v) throw new HttpError(404, 'Laporan tidak ditemukan.');
    if (v.status === 'approved') throw new HttpError(409, 'Laporan yang sudah disahkan tidak bisa dihapus (arsip surat).');
    await db.query('DELETE FROM violations WHERE id=$1', [id]);
    await logHistory(db, { action: 'pelanggaran_hapus', description: `Menghapus laporan pelanggaran #${id} "${v.jenis}"`, memberId: v.member_id, memberName: v.member_name, actor: actorOf(req.user) });
  });
  res.json({ ok: true });
}));

module.exports = router;
