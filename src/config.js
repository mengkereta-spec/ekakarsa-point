require('dotenv').config({ quiet: true });

const env = process.env;
const isProd = env.NODE_ENV === 'production';

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET wajib diisi (minimal 32 karakter) di production.');
}

module.exports = {
  isProd,
  port: Number(env.PORT || 3000),
  databaseUrl: env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/ekakarsa',
  dbSsl: env.DATABASE_SSL === 'true',
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me-dev-only-secret',
  sessionHours: Number(env.SESSION_HOURS || 12),
  // Jumlah persetujuan (pembina/ketua/calon ketua) yang dibutuhkan agar pelanggaran disahkan.
  requiredApprovals: Math.max(1, Number(env.REQUIRED_APPROVALS || 1)),
  minWitnesses: Math.max(2, Number(env.MIN_WITNESSES || 2)),
  initialAdmin: {
    username: env.ADMIN_USERNAME || 'admin',
    password: env.ADMIN_PASSWORD || '',
    name: env.ADMIN_NAME || 'Administrator',
  },
  schoolName: env.SCHOOL_NAME || 'OSIS Ekakarsa',
  trustProxy: env.TRUST_PROXY || (isProd ? '1' : 'false'),
};
