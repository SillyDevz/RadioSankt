const fs = require('fs');
const path = require('path');

const enPath = path.join(__dirname, '..', 'src', 'renderer', 'i18n', 'locales', 'en', 'common.json');
const ptPath = path.join(__dirname, '..', 'src', 'renderer', 'i18n', 'locales', 'pt', 'common.json');

const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const pt = JSON.parse(fs.readFileSync(ptPath, 'utf8'));

const missingInPt = Object.keys(en).filter((k) => !(k in pt));
const extraInPt = Object.keys(pt).filter((k) => !(k in en));

if (missingInPt.length || extraInPt.length) {
  if (missingInPt.length) {
    console.error('Missing keys in pt/common.json:');
    missingInPt.forEach((k) => console.error(`- ${k}`));
  }
  if (extraInPt.length) {
    console.error('Extra keys in pt/common.json:');
    extraInPt.forEach((k) => console.error(`- ${k}`));
  }
  process.exit(1);
}

console.log('i18n locale keys are aligned.');
