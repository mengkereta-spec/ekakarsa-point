# Ekakarsa Point — Sistem Manajemen Poin & Pelanggaran OSIS

Aplikasi web (frontend + backend + database PostgreSQL) berdasarkan prototipe *Ekakarsa Point*.

## Fitur

**Publik / Anggota (tanpa login, hanya melihat)**
- Dashboard (total poin & jumlah pengurus), daftar anggota, divisi, program kerja
- Riwayat seluruh perubahan poin (siapa, kapan, alasan, poin sebelum → sesudah), bisa difilter per anggota
- Tidak ada tombol edit; semua perubahan ditolak oleh server tanpa login

**Admin**
- Tambah / kurangi poin anggota (wajib alasan, otomatis tercatat di Riwayat)
- Tambah, edit, hapus anggota · tambah/hapus divisi · tambah/hapus program kerja
- Reset seluruh poin anggota ke 0 (wajib ketik `RESET` + password; tiap anggota tercatat di Riwayat)
- Import anggota dari Excel (.xlsx) dengan pratinjau; anggota & divisi baru dibuat otomatis, duplikat (nama+kelas) dilewati atau diperbarui
- Unduh template Excel, ekspor data anggota ke Excel
- Kelola akun pengelola: Admin, Pembina OSIS, Ketua OSIS, Calon Ketua OSIS

**Manajemen barang**
- Daftar inventaris OSIS: nama, kategori, jumlah, satuan, kondisi (baik / rusak ringan / rusak berat), lokasi, catatan. Tambah/edit/hapus khusus admin.
- Peminjaman barang dicatat oleh akun pengelola mana pun (peminjam anggota OSIS atau nama lain), stok tersedia dihitung otomatis dan tidak bisa dipinjam melebihi stok. Pengembalian mencatat kondisi barang. Peminjaman yang lewat tanggal kembali ditandai *terlambat*.

**Sistem piket**
- Jadwal piket mingguan Senin–Sabtu (anggota + tugas), diatur admin. Hari ini ditandai di tampilan.
- Absensi piket harian (hadir / izin / sakit / alpa + catatan) diisi akun pengelola mana pun, plus rekap absensi 30 hari terakhir. Anggota bisa melihat tanpa login.

**Sistem pelanggaran**
- Laporan pelanggaran dibuat oleh akun pengelola mana pun, **wajib minimal 2 saksi** berbeda (anggota OSIS atau nama lain, mis. guru). Terlapor tidak bisa menjadi saksi.
- Poin **baru dikurangi setelah disetujui** Pembina / Ketua / Calon Ketua OSIS. Jumlah persetujuan yang dibutuhkan diatur lewat `REQUIRED_APPROVALS` (default 1 = salah satu cukup).
- Pelapor tidak boleh menyetujui laporannya sendiri; penolakan wajib disertai alasan.
- Setelah disahkan, terbit **Surat Keterangan Pelanggaran** bernomor otomatis (mis. `001/SKP/OSIS/XI/2026`) yang siap dicetak / disimpan PDF di `/surat/<id>`.
- Daftar laporan & surat hanya bisa dilihat akun pengelola (data pribadi). Pengurangan poinnya tetap tampil di Riwayat publik.

## Keamanan
- Login di server: password di-hash bcrypt, sesi JWT di cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` di production)
- Semua aksi tulis dicek perannya di server; header anti-CSRF wajib
- Batas percobaan login (10 per 15 menit), rate limit API, Helmet + Content-Security-Policy ketat, tanpa CDN pihak ketiga
- Ganti password otomatis mengeluarkan sesi di perangkat lain
- Setiap aksi tercatat di tabel `history` (audit log)

## Menjalankan

### Opsi A — VPS dengan Docker Compose (disarankan)
Panduan lengkap langkah demi langkah (Docker, Nginx, HTTPS, pindah data dari Supabase, backup): **[DEPLOY-VPS.md](DEPLOY-VPS.md)**.
```bash
cp .env.example .env      # isi JWT_SECRET (openssl rand -hex 32), ADMIN_PASSWORD, POSTGRES_PASSWORD, SCHOOL_NAME
docker compose up -d --build
```
Aplikasi mendengarkan di `127.0.0.1:3000`; akses publik lewat Nginx + HTTPS (`deploy/nginx-ekakarsa.conf`).

### Opsi B — Vercel + Supabase (yang dipakai saat ini)
- Frontend statis dari `public/`, backend sebagai fungsi serverless `api/index.js` (lihat `vercel.json`).
- Database Supabase memakai role khusus `ekakarsa_app` dan skema `ekakarsa` (tidak terekspos ke API publik Supabase).
- Env di Vercel: `NODE_ENV=production`, `DATABASE_URL` (pooler Supabase port 6543), `DATABASE_SSL=true`, `DB_POOL_MAX=3`, `JWT_SECRET`, `ADMIN_PASSWORD`, `TRUST_PROXY=1`, `NODEJS_HELPERS=0`.

### Opsi C — Node.js + PostgreSQL terkelola (Railway, Render, Supabase/Neon, dll.)
1. Buat database PostgreSQL, salin connection string ke `DATABASE_URL` (set `DATABASE_SSL=true` bila perlu).
2. Set env `NODE_ENV=production`, `JWT_SECRET`, `ADMIN_PASSWORD`, `TRUST_PROXY=1`.
3. Build command: `npm ci` · Start command: `npm start`

Tabel dibuat otomatis saat aplikasi pertama kali jalan, lengkap dengan 10 divisi bawaan dan akun admin pertama dari `ADMIN_USERNAME`/`ADMIN_PASSWORD`. **Segera ganti password** setelah login pertama.

### Pengembangan lokal
```bash
npm install
cp .env.example .env   # NODE_ENV=development, isi DATABASE_URL & ADMIN_PASSWORD
npm run dev
npm run build:css      # setelah mengubah class Tailwind di public/
TEST_DATABASE_URL=postgres://postgres@localhost:5432/ekakarsa_test npm test
```

## Langkah awal setelah deploy
1. Masuk sebagai admin (tab **Akses Admin**), ganti password.
2. Import `data/Pengurus_OSIS_2026-2027.xlsx` (43 pengurus) lewat **Import Anggota dari Excel**.
3. Atur divisi & jabatan tiap anggota (edit langsung, atau isi kolom Divisi di Excel lalu import ulang dengan centang *Perbarui*).
4. Buat akun untuk Pembina, Ketua, dan Calon Ketua OSIS.

## Format Excel import
| Nama (wajib) | Kelas | Divisi | Jabatan | Poin |
|---|---|---|---|---|
| Adam Zainuddin Rabbani | X | Divisi IT | Anggota | 0 |

Divisi boleh ditulis `IT` atau `Divisi IT`. Divisi yang belum ada dibuat otomatis. Kolom Poin hanya dipakai untuk anggota baru.

## Struktur
```
src/server.js             entry point
src/app.js                Express, keamanan, routing
src/db.js, db/schema.sql  koneksi & skema PostgreSQL (migrasi otomatis)
src/routes/*.js           API: auth, data, import/export, pelanggaran, barang (inventory), piket
public/                   frontend (HTML + JS + Tailwind hasil build)
public/surat.*            halaman surat keterangan pelanggaran
test/api.test.js          uji integrasi API
deploy/                   konfigurasi & skrip VPS: nginx, PM2, update, backup, import dari Supabase
```
