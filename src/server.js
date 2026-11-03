const config = require('./config');
const { migrate, pool } = require('./db');
const { createApp } = require('./app');

(async () => {
  await migrate();
  const server = createApp().listen(config.port, () => console.log(`Ekakarsa Point berjalan di http://localhost:${config.port}`));
  const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})().catch((e) => { console.error(e); process.exit(1); });
