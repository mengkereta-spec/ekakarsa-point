# Panduan Deploy Ekakarsa Point ke VPS

Panduan ini untuk VPS Ubuntu 22.04/24.04 (minimal 1 vCPU, 1 GB RAM). Semua perintah dijalankan lewat SSH.

Ada dua pilihan database:

| Pilihan | Kapan dipakai | File compose |
|---|---|---|
| **A. PostgreSQL di VPS** (disarankan) | Semua di satu server, tidak bergantung Supabase | `docker-compose.yml` |
| **B. Tetap pakai Supabase** | Mau pindah hosting aplikasinya saja, data tetap di Supabase | `docker-compose.supabase.yml` |

Data di Supabase bisa dipindahkan ke pilihan A dengan satu perintah (langkah 5).

---

## 1. Siapkan server

```bash
sudo apt update && sudo apt -y upgrade
# Docker + Compose
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # logout lalu login SSH lagi agar berlaku
# Nginx + HTTPS
sudo apt -y install nginx certbot python3-certbot-nginx git
# Firewall: hanya SSH dan web
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

## 2. Ambil kode

```bash
git clone https://github.com/mengkereta-spec/ekakarsa-point.git
cd ekakarsa-point
```

Repo private? Pakai deploy key atau Personal Access Token GitHub saat `git clone`.

## 3. Isi konfigurasi `.env`

```bash
cp .env.example .env
openssl rand -hex 32          # salin hasilnya ke JWT_SECRET
nano .env
```

Yang wajib diisi:

- `JWT_SECRET`: hasil `openssl rand -hex 32`
- `ADMIN_PASSWORD`: password admin pertama (min. 8 karakter, hanya dipakai bila database masih kosong)
- `SCHOOL_NAME`: nama di kop surat
- Pilihan A: `POSTGRES_PASSWORD` (password acak yang kuat)
- Pilihan B: `DATABASE_URL` = connection string **Session pooler** Supabase (port **5432**, bukan 6543), `DATABASE_SSL=true`, `DB_POOL_MAX=5`

Biarkan `APP_BIND=127.0.0.1` agar aplikasi hanya bisa diakses lewat Nginx.

## 4. Jalankan aplikasi

```bash
# Pilihan A (PostgreSQL di VPS)
docker compose up -d --build

# Pilihan B (Supabase)
docker compose -f docker-compose.supabase.yml up -d --build
```

Cek:

```bash
docker compose ps                         # status "healthy" (pilihan B: tambahkan -f docker-compose.supabase.yml)
docker compose logs -f app                # log aplikasi (Ctrl+C untuk keluar)
curl http://127.0.0.1:3000/healthz        # {"ok":true}
```

Tabel database, 10 divisi bawaan, dan akun admin dibuat otomatis saat pertama jalan.

## 5. (Opsional) Pindahkan data dari Supabase ke VPS

Hanya untuk pilihan A, dijalankan **sekali** sebelum aplikasi dipakai. Ambil connection string *Session pooler* di Supabase (Project Settings > Database > Connect), lalu:

```bash
./deploy/import-from-supabase.sh 'postgresql://USER:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'
```

Skrip ini menyalin seluruh skema `ekakarsa` (anggota, riwayat poin, pelanggaran, barang, piket, akun) ke PostgreSQL di VPS, menyimpan salinan dump di `backups/`, lalu menjalankan ulang aplikasi. Login memakai akun dan password yang sama seperti di Supabase. Skrip menolak berjalan bila data sudah pernah diimpor, agar tidak menimpa data.

## 6. Pasang domain dan HTTPS

1. Arahkan DNS domain (record **A**) ke IP VPS.
2. Pasang konfigurasi Nginx:

```bash
sudo cp deploy/nginx-ekakarsa.conf /etc/nginx/sites-available/ekakarsa
sudo sed -i 's/DOMAIN_ANDA/osis.sekolahanda.sch.id/' /etc/nginx/sites-available/ekakarsa
sudo ln -s /etc/nginx/sites-available/ekakarsa /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d osis.sekolahanda.sch.id    # HTTPS gratis, perpanjang otomatis
```

Buka `https://osis.sekolahanda.sch.id`.

> **Penting:** login hanya berfungsi lewat HTTPS (cookie `Secure`). Belum punya domain dan ingin uji coba sebentar lewat `http://IP:3000`? Set `COOKIE_SECURE=false` dan `APP_BIND=0.0.0.0` di `.env`, buka port dengan `sudo ufw allow 3000`, jalankan `docker compose up -d`. Kembalikan ke `true`/`127.0.0.1` dan tutup port setelah selesai.

## 7. Setelah online

1. Masuk sebagai admin, **ganti password**.
2. Import anggota dari `data/Pengurus_OSIS_2026-2027.xlsx` (bila belum memindahkan data dari Supabase).
3. Buat akun Pembina, Ketua, dan Calon Ketua OSIS.

## Perawatan

**Update ke versi terbaru dari GitHub**

```bash
./deploy/update.sh             # pilihan A
./deploy/update.sh supabase    # pilihan B
```

Perubahan skema database (tabel baru) diterapkan otomatis saat aplikasi start.

**Backup harian (pilihan A)**

```bash
./deploy/backup-db.sh                        # backup sekarang ke folder backups/
crontab -e                                   # lalu tambahkan baris berikut (ganti path):
0 2 * * * /home/USER/ekakarsa-point/deploy/backup-db.sh >> /home/USER/ekakarsa-point/backups/backup.log 2>&1
```

Simpan juga salinan backup di luar VPS (Google Drive, laptop). Memulihkan backup:

```bash
gunzip -c backups/ekakarsa-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T db psql -U ekakarsa -d ekakarsa
```

**Perintah berguna**

```bash
docker compose restart app          # restart aplikasi
docker compose down                 # hentikan (data tetap aman di volume)
docker compose exec db psql -U ekakarsa -d ekakarsa    # masuk ke database
```

> Jangan jalankan `docker compose down -v`: opsi `-v` menghapus seluruh data database.

---

## Alternatif tanpa Docker (Node.js + PM2)

Butuh Node.js 20+ dan PostgreSQL (lokal atau Supabase).

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt -y install nodejs
sudo npm i -g pm2
cp .env.example .env && nano .env          # isi DATABASE_URL lengkap, JWT_SECRET, ADMIN_PASSWORD
npm ci && npm run build
pm2 start deploy/ecosystem.config.cjs
pm2 save && pm2 startup                    # jalankan perintah yang ditampilkan agar otomatis start saat reboot
```

Nginx dan HTTPS sama seperti langkah 6. Update: `git pull && npm ci && npm run build && pm2 restart ekakarsa-point`.

## Masalah umum

| Gejala | Penyebab & solusi |
|---|---|
| Halaman terbuka tapi tidak bisa login | Diakses lewat `http://` tanpa HTTPS. Pasang HTTPS (langkah 6) atau sementara `COOKIE_SECURE=false`. |
| `502 Bad Gateway` dari Nginx | Aplikasi belum jalan. Cek `docker compose ps` dan `docker compose logs app`. |
| `JWT_SECRET wajib diisi` di log | `JWT_SECRET` kosong atau kurang dari 32 karakter di `.env`. |
| `Database belum siap` / error koneksi (Supabase) | Pakai Session pooler port 5432 dan `DATABASE_SSL=true`; pastikan project Supabase tidak sedang *paused*. |
| Belum ada akun admin | `ADMIN_PASSWORD` kosong saat pertama start. Isi, lalu `docker compose restart app`. |
