// Menyalin Font Awesome ke public/vendor agar tidak bergantung CDN.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'node_modules', '@fortawesome', 'fontawesome-free');
const dst = path.join(__dirname, '..', 'public', 'vendor', 'fontawesome');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(path.join(dst, 'css'), { recursive: true });
fs.copyFileSync(path.join(src, 'css', 'all.min.css'), path.join(dst, 'css', 'all.min.css'));
fs.cpSync(path.join(src, 'webfonts'), path.join(dst, 'webfonts'), { recursive: true });
console.log('Font Awesome disalin ke public/vendor/fontawesome');
