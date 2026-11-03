const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const config = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DB_POOL_MAX || 10),
});

const query = (text, params) => pool.query(text, params);

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const DEFAULT_DIVISIONS = [
  'Divisi Agama', 'Divisi Kesehatan Jasmani', 'Divisi Budi Pekerti', 'Divisi IT', 'Divisi HUMAS',
  'Divisi KWU', 'Divisi Prestasi', 'Divisi Bahasa Inggris', 'Divisi KBBN', 'Divisi Sastra Budaya',
];

async function migrate({ log = console.log } = {}) {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await tx(async (db) => {
    // Kunci agar beberapa instance (mis. serverless) tidak migrasi bersamaan.
    await db.query('SELECT pg_advisory_xact_lock(7171717)');
    await db.query(sql);

    const { rows: d } = await db.query('SELECT count(*)::int AS n FROM divisions');
    if (d[0].n === 0) {
      for (const name of DEFAULT_DIVISIONS) {
        await db.query('INSERT INTO divisions (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
      }
      log('[db] 10 divisi bawaan ditambahkan');
    }

    const { rows: u } = await db.query('SELECT count(*)::int AS n FROM users');
    if (u[0].n === 0) {
      const { username, password, name } = config.initialAdmin;
      if (!password || password.length < 8) {
        log('[db] PERINGATAN: belum ada akun. Isi ADMIN_PASSWORD (min. 8 karakter) lalu restart untuk membuat admin pertama.');
      } else {
        const hash = await bcrypt.hash(password, 12);
        await db.query(
          "INSERT INTO users (username, display_name, password_hash, role) VALUES ($1,$2,$3,'admin') ON CONFLICT (username) DO NOTHING",
          [username.toLowerCase(), name, hash]
        );
        log(`[db] akun admin pertama "${username}" dibuat`);
      }
    }
  });
}

module.exports = { pool, query, tx, migrate, DEFAULT_DIVISIONS };
