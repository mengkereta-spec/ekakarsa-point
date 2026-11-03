// Entry point serverless untuk Vercel. Semua request /api/* dan /healthz diarahkan ke sini.
const { createApp } = require('../src/app');
const { migrate } = require('../src/db');

const app = createApp();
let ready = null;

module.exports = async (req, res) => {
  if (!ready) ready = migrate().catch((e) => { ready = null; throw e; });
  try {
    await ready;
  } catch (e) {
    console.error('[migrate]', e);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Database belum siap. Coba lagi sebentar.' }));
  }
  return app(req, res);
};
