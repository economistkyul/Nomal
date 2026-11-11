// 서버 없이 여는 단일 HTML 만들기: node build_preview.js → preview.html
const fs = require('fs');
const inline = f => '<script>\n' + fs.readFileSync(f, 'utf8').replace(/<\/script/g, '<\\/script') + '\n</script>';
const seed = JSON.stringify(require('./data/sentinel.json')).replace(/</g, '\\u003c');
const out = fs.readFileSync('index.html', 'utf8')
  .replace('<script src="detect.js"></script>', inline('detect.js') + '\n<script>window.SEED_DATA=' + seed + ';</script>');
fs.writeFileSync('preview.html', out);
console.log('preview.html', out.length);
