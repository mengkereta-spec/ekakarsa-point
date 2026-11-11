// Alternatif tanpa Docker: jalankan dengan PM2.
//   npm ci && npm run build
//   pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
// Variabel lingkungan dibaca dari file .env di root proyek.
module.exports = {
  apps: [
    {
      name: 'ekakarsa-point',
      script: 'src/server.js',
      cwd: __dirname + '/..',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production', TZ: 'Asia/Jakarta' },
      max_memory_restart: '300M',
      time: true,
    },
  ],
};
