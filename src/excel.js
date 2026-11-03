const ExcelJS = require('exceljs');

const HEADER_ALIASES = {
  name: ['nama', 'nama anggota', 'nama lengkap', 'name'],
  kelas: ['kelas', 'class'],
  division: ['divisi', 'division', 'bidang', 'seksi'],
  jabatan: ['jabatan', 'posisi', 'position'],
  points: ['poin', 'point', 'poin awal', 'points'],
};

function cellText(cell) {
  const v = cell?.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
}

const clean = (s) => String(s).replace(/\s+/g, ' ').trim();

/** Membaca file .xlsx dan mengembalikan baris anggota { row, name, kelas, division, jabatan, points }. */
async function parseMembersWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch (_) {
    throw Object.assign(new Error('File tidak bisa dibaca. Pastikan formatnya .xlsx.'), { status: 400 });
  }
  const ws = wb.worksheets.find((s) => s.state !== 'hidden') || wb.worksheets[0];
  if (!ws) throw Object.assign(new Error('File Excel kosong.'), { status: 400 });

  // Cari baris header (10 baris pertama) yang memuat kolom "Nama".
  let headerRow = null; let map = null;
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const row = ws.getRow(r); const m = {};
    row.eachCell((cell, col) => {
      const t = clean(cellText(cell)).toLowerCase();
      for (const [key, aliases] of Object.entries(HEADER_ALIASES)) if (aliases.includes(t) && !m[key]) m[key] = col;
    });
    if (m.name) { headerRow = r; map = m; break; }
  }
  if (!headerRow) throw Object.assign(new Error('Kolom "Nama" tidak ditemukan di baris header.'), { status: 400 });

  const rows = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (k) => (map[k] ? clean(cellText(row.getCell(map[k]))) : '');
    const name = get('name');
    if (!name) continue;
    const rawPoints = get('points');
    const points = rawPoints === '' ? 0 : Number(rawPoints.replace(',', '.'));
    rows.push({
      row: r, name, kelas: get('kelas'), division: get('division'), jabatan: get('jabatan') || 'Anggota',
      points: Number.isFinite(points) ? Math.trunc(points) : NaN,
    });
  }
  return rows;
}

async function buildMembersWorkbook(members, divisions) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ekakarsa Point';
  const ws = wb.addWorksheet('Anggota');
  ws.columns = [
    { header: 'No', key: 'no', width: 5 },
    { header: 'Nama', key: 'name', width: 38 },
    { header: 'Kelas', key: 'kelas', width: 8 },
    { header: 'Divisi', key: 'division', width: 26 },
    { header: 'Jabatan', key: 'jabatan', width: 18 },
    { header: 'Poin', key: 'points', width: 8 },
  ];
  members.forEach((m, i) => ws.addRow({ no: i + 1, ...m }));
  styleSheet(ws, divisions);
  return wb;
}

function styleSheet(ws, divisions = []) {
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } };
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  header.height = 20;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columnCount } };
  const last = Math.max(ws.rowCount, 200);
  if (divisions.length) {
    const list = ws.workbook.addWorksheet('Daftar Divisi', { state: 'visible' });
    list.getColumn(1).width = 30;
    list.getCell('A1').value = 'Daftar Divisi (pilihan untuk kolom Divisi)';
    list.getCell('A1').font = { bold: true };
    divisions.forEach((d, i) => { list.getCell(`A${i + 2}`).value = d; });
    const divCol = ws.columns.findIndex((c) => c.key === 'division') + 1;
    for (let r = 2; r <= last; r++) {
      ws.getRow(r).getCell(divCol).dataValidation = {
        type: 'list', allowBlank: true, showErrorMessage: false,
        formulae: [`'Daftar Divisi'!$A$2:$A$${divisions.length + 1}`],
      };
    }
  }
}

module.exports = { parseMembersWorkbook, buildMembersWorkbook };
