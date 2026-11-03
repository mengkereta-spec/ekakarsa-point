const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { query } = require('../db');
const { issueSession, clearSession, requireAuth, ROLE_LABEL } = require('../auth');
const { wrap, parseBody, HttpError } = require('../util');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan masuk. Coba lagi 15 menit lagi.' },
});

// Hash dummy agar waktu respons sama walau username tidak ada.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

const publicUser = (u) => u && ({
  id: u.id, username: u.username, name: u.display_name, role: u.role, roleLabel: ROLE_LABEL[u.role],
});

router.post('/login', loginLimiter, wrap(async (req, res) => {
  const { username, password } = parseBody(z.object({
    username: z.string().trim().min(1, 'Username wajib diisi').max(64),
    password: z.string().min(1, 'Password wajib diisi').max(200),
  }), req.body);
  const { rows } = await query('SELECT * FROM users WHERE username = $1', [username.toLowerCase()]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Username atau password salah.');
  issueSession(res, user);
  res.json({ user: publicUser(user) });
}));

router.post('/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

router.get('/me', (req, res) => res.json({ user: publicUser(req.user) }));

router.post('/password', requireAuth, wrap(async (req, res) => {
  const { oldPassword, newPassword } = parseBody(z.object({
    oldPassword: z.string().min(1),
    newPassword: z.string().min(8, 'Password baru minimal 8 karakter').max(200),
  }), req.body);
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(oldPassword, rows[0].password_hash))) throw new HttpError(400, 'Password lama salah.');
  const hash = await bcrypt.hash(newPassword, 12);
  const { rows: up } = await query(
    'UPDATE users SET password_hash=$1, token_version = token_version + 1 WHERE id=$2 RETURNING *',
    [hash, req.user.id]
  );
  issueSession(res, up[0]);
  res.json({ ok: true });
}));

module.exports = { router, publicUser };
