/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const enPath = path.join(root, 'src', 'renderer', 'i18n', 'locales', 'en', 'common.json');
const ptPath = path.join(root, 'src', 'renderer', 'i18n', 'locales', 'pt', 'common.json');

const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const pt = JSON.parse(fs.readFileSync(ptPath, 'utf8'));

function collectRendererSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'i18n' || entry.name === 'node_modules') continue;
      collectRendererSources(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

const rendererDir = path.join(root, 'src', 'renderer');
const usedKeys = new Set();
const reLiteral = /\b(?:i18n\.)?t\s*\(\s*['"]([a-zA-Z0-9_.\-]+)['"]/g;

for (const file of collectRendererSources(rendererDir)) {
  const src = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = reLiteral.exec(src)) !== null) {
    usedKeys.add(m[1]);
  }
}

const missingInEn = [...usedKeys].filter((k) => !(k in en)).sort();
const missingInPt = Object.keys(en)
  .filter((k) => !(k in pt))
  .sort();
const extraInPt = Object.keys(pt)
  .filter((k) => !(k in en))
  .sort();

let failed = false;

if (missingInEn.length > 0) {
  console.error('i18n keys used in code but missing from en/common.json:');
  missingInEn.forEach((k) => console.error(`- ${k}`));
  failed = true;
}
if (missingInPt.length > 0) {
  console.error('Keys present in en/common.json but missing from pt/common.json:');
  missingInPt.forEach((k) => console.error(`- ${k}`));
  failed = true;
}
if (extraInPt.length > 0) {
  console.error('Stale keys in pt/common.json (not present in en/common.json):');
  extraInPt.forEach((k) => console.error(`- ${k}`));
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log(`i18n OK (${usedKeys.size} keys used in code, ${Object.keys(en).length} keys in EN).`);
