// Membuat file Excel pengurus OSIS 2026/2027 yang siap di-import.
const path = require('path');
const { buildMembersWorkbook } = require('../src/excel');
const { DEFAULT_DIVISIONS } = require('../src/db');

const X = ['Adam Zainuddin Rabbani', 'Agustinus Carlos Tubo', 'Aisyah Ananda Putri Ramadhan', 'Al Rizky Pratama', 'Ari Saputra',
  'Audra Abqary Dhiyauddin', 'Efran Julio Akbar', 'Gideon Yoel Pratama', 'Jenyfher Relashy Anggi Sianturi', 'Laras Nurmaulidia',
  'Masachika Zephaniah', 'Miska Likasina Br Ginting', 'Mohammad Satria Rizki Umar', 'Muhammad Arfa Mirza', 'Nadia Callysta Luthfianty',
  "Nanda Nur Sya'bania", 'Oktaviani Nuraini', 'Rafi AL-Basyith', 'Rama Jerry Luis Dotulong', 'Reren Rahma Tiana', 'Sadam Akbar',
  'Safira Indriyani', 'Syifa Maulida Putri', 'Yesaya Pamungkas'];
const XI = ['Aisyah Shakila Akbar', 'Chantika Mariam Nur', 'Damar Nur Pratama', 'Fatma Nadila Azahra', 'Frederick Xavier Rivano',
  'Habil Syauqi', 'Hilda Widi Arfina', 'Indra Haqqi Rauffi', 'Keza Janestia Mega', 'Kezia Effata Adonai', 'Marsya Amalia Putri',
  'Mochammad Mufti Al Fikri', 'Mutiara Liana Azura', 'Nizar Zulmi Rambani', 'Rania Athaya Rizki', 'Salshabilla Putri F',
  'Satria Ryu Ramadhan', 'Timothy Gamaliel Riyaditya', 'Yehezkiel Erlangga Rahadid'];

(async () => {
  const rows = [...X.map((name) => ({ name, kelas: 'X' })), ...XI.map((name) => ({ name, kelas: 'XI' }))]
    .map((r) => ({ ...r, division: '', jabatan: 'Anggota', points: 0 }));
  const wb = await buildMembersWorkbook(rows, DEFAULT_DIVISIONS);
  wb.worksheets[0].name = 'Pengurus OSIS 2026-2027';
  const out = process.argv[2] || path.join(__dirname, '..', 'data', 'Pengurus_OSIS_2026-2027.xlsx');
  await wb.xlsx.writeFile(out);
  console.log(`${rows.length} anggota ditulis ke ${out}`);
})();
