const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { loadUser, csrfGuard } = require('./auth');
const { query } = require('./db');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy !== 'false') app.set('trust proxy', Number(config.trustProxy) || config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
  }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  app.get('/healthz', async (_req, res) => {
    try { await query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use(csrfGuard);
  api.use(loadUser);
  api.use('/auth', require('./routes/auth').router);
  api.use(require('./routes/data'));
  api.use(require('./routes/importExport'));
  api.use(require('./routes/violations'));
  api.use((_req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));
  // eslint-disable-next-line no-unused-vars
  api.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' || err.name === 'MulterError' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Terjadi kesalahan pada server.' : err.message });
  });
  app.use('/api', api);

  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '1h' : 0 }));
  app.get('/surat/:id', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'surat.html')));
  return app;
}

module.exports = { createApp };
