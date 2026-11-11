const jwt = require('jsonwebtoken');
const { query } = require('./db');
const config = require('./config');

const COOKIE = 'ep_session';
const ROLES = ['admin', 'pembina', 'ketua', 'calon_ketua'];
const APPROVER_ROLES = ['pembina', 'ketua', 'calon_ketua'];
const ROLE_LABEL = { admin: 'Admin', pembina: 'Pembina OSIS', ketua: 'Ketua OSIS', calon_ketua: 'Calon Ketua OSIS' };

function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id, v: user.token_version }, config.jwtSecret, {
    expiresIn: `${config.sessionHours}h`,
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict',
    maxAge: config.sessionHours * 3600 * 1000,
    path: '/',
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/', sameSite: 'strict', secure: config.secureCookies, httpOnly: true });
}

// Membaca sesi (jika ada) dan memvalidasinya ke database pada setiap request.
async function loadUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const { rows } = await query(
      'SELECT id, username, display_name, role, token_version FROM users WHERE id = $1',
      [payload.sub]
    );
    const u = rows[0];
    if (u && u.token_version === payload.v) req.user = u;
  } catch (_) { /* token tidak valid / kedaluwarsa */ }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Anda tidak memiliki izin untuk aksi ini.' });
    }
    next();
  };
}

const requireAuth = requireRole();
const requireAdmin = requireRole('admin');

// Proteksi CSRF ringan: semua request yang mengubah data wajib membawa header khusus
// (tidak bisa dikirim lintas-situs tanpa preflight CORS), ditambah cookie SameSite=Strict.
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'EkakarsaPoint') {
    return res.status(403).json({ error: 'Permintaan ditolak (CSRF).' });
  }
  next();
}

module.exports = {
  COOKIE, ROLES, APPROVER_ROLES, ROLE_LABEL,
  issueSession, clearSession, loadUser, requireAuth, requireAdmin, requireRole, csrfGuard,
};
