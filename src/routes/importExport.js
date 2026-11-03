const express = require('express');
const multer = require('multer');
const { query, tx } = require('../db');
const { requireAdmin, ROLE_LABEL } = require('../auth');
const { wrap, HttpError, logHistory } = require('../util');
const { parseMembersWorkbook, buildMembersWorkbook } = require('../excel');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /\.xlsx$/i.test(file.originalname)),
});

const norm = (s) => s.toLowerCase().replace(/^divisi\s+/, '').replace(/\s+/g, ' ').trim();

/**
 * Import anggota dari Excel. Anggota baru dibuat otomatis.
 * Query: dryRun=1 (pratinjau saja), mode=skip|update (anggota yang sudah ada: lewati / perbarui kelas-divisi-jabatan).
 * Divisi yang belum ada akan dibuat otomatis.
 */
router.post('/import/members', requireAdmin, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Unggah file .xlsx (maks. 5 MB).');
  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
  const mode = req.query.mode === 'update' ? 'update' : 'skip';
  const rows = await parseMembersWorkbook(req.file.buffer);
  if (!rows.length) throw new HttpError(400, 'Tidak ada baris anggota yang terbaca.');
  if (rows.length > 2000) throw new HttpError(400, 'Maksimal 2000 baris per import.');
  const actor = `${req.user.display_name} (${ROLE_LABEL[req.user.role]})`;

  const result = await tx(async (db) => {
    const divs = (await db.query('SELECT id, name FROM divisions')).rows;
    const divByKey = new Map(divs.map((d) => [norm(d.name), d]));
    const existing = (await db.query('SELECT id, name, kelas FROM members')).rows;
    const memberKey = (n, k) => `${n.toLowerCase()}|${k.toLowerCase()}`;
    const memByKey = new Map(existing.map((m) => [memberKey(m.name, m.kelas), m]));
    const seen = new Set();
    const report = { created: [], updated: [], skipped: [], errors: [], newDivisions: [] };

    for (const r of rows) {
      if (r.name.length > 120) { report.errors.push({ row: r.row, name: r.name, reason: 'Nama terlalu panjang' }); continue; }
      if (!Number.isFinite(r.points)) { report.errors.push({ row: r.row, name: r.name, reason: 'Poin bukan angka' }); continue; }
      const key = memberKey(r.name, r.kelas);
      if (seen.has(key)) { report.skipped.push({ row: r.row, name: r.name, reason: 'Duplikat di dalam file' }); continue; }
      seen.add(key);

      let divisionId = null;
      if (r.division) {
        let d = divByKey.get(norm(r.division));
        if (!d) {
          const dname = /^divisi\s/i.test(r.division) ? r.division : `Divisi ${r.division}`;
          d = dryRun ? { id: null, name: dname }
            : (await db.query('INSERT INTO divisions (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id, name', [dname])).rows[0];
          divByKey.set(norm(dname), d);
          report.newDivisions.push(dname);
          if (!dryRun) await logHistory(db, { action: 'divisi_tambah', description: `Menambahkan divisi "${dname}" (otomatis dari import Excel)`, actor });
        }
        divisionId = d.id;
      }

      const ex = memByKey.get(key);
      if (ex) {
        if (mode === 'skip') { report.skipped.push({ row: r.row, name: r.name, reason: 'Sudah terdaftar' }); continue; }
        if (!dryRun) {
          await db.query('UPDATE members SET division_id=COALESCE($1, division_id), jabatan=$2 WHERE id=$3', [divisionId, r.jabatan.slice(0, 60), ex.id]);
        }
        report.updated.push({ row: r.row, name: r.name });
        continue;
      }
      if (!dryRun) {
        const m = (await db.query(
          'INSERT INTO members (name, kelas, division_id, jabatan, points) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [r.name, r.kelas.slice(0, 20), divisionId, r.jabatan.slice(0, 60), r.points])).rows[0];
        await logHistory(db, { action: 'anggota_tambah', description: `Menambahkan anggota "${r.name}" via import Excel (poin awal ${r.points})`, memberId: m.id, memberName: r.name, delta: r.points, before: 0, after: r.points, actor });
      }
      report.created.push({ row: r.row, name: r.name, kelas: r.kelas, division: r.division || '-', jabatan: r.jabatan, points: r.points });
    }
    if (!dryRun && (report.created.length || report.updated.length)) {
      await logHistory(db, { action: 'import_excel', description: `Import Excel "${req.file.originalname}": ${report.created.length} anggota baru, ${report.updated.length} diperbarui, ${report.skipped.length} dilewati`, actor });
    }
    return report;
  });
  res.json({ dryRun, mode, total: rows.length, ...result });
}));

async function sendWorkbook(res, wb, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

router.get('/import/template', wrap(async (_req, res) => {
  const divs = (await query('SELECT name FROM divisions ORDER BY id')).rows.map((d) => d.name);
  const wb = await buildMembersWorkbook([
    { name: 'Contoh Nama Siswa', kelas: 'X', division: divs[0] || '', jabatan: 'Anggota', points: 0 },
  ], divs);
  await sendWorkbook(res, wb, 'template-import-anggota.xlsx');
}));

router.get('/export/members', requireAdmin, wrap(async (_req, res) => {
  const divs = (await query('SELECT name FROM divisions ORDER BY id')).rows.map((d) => d.name);
  const { rows } = await query(`SELECT m.name, m.kelas, COALESCE(d.name,'') AS division, m.jabatan, m.points
    FROM members m LEFT JOIN divisions d ON d.id=m.division_id ORDER BY m.kelas, m.name`);
  const wb = await buildMembersWorkbook(rows, divs);
  await sendWorkbook(res, wb, `anggota-osis-${new Date().toISOString().slice(0, 10)}.xlsx`);
}));

module.exports = router;
