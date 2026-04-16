/**
 * npm's extract step for Electron sometimes drops macOS symlinks inside .framework bundles.
 * Without them, dyld fails: "Library not loaded: @rpath/.../Electron Framework.framework/Electron Framework"
 */
const fs = require('fs');
const path = require('path');

if (process.platform !== 'darwin') process.exit(0);

const frameworksDir = path.join(
  __dirname,
  '..',
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
  'Contents',
  'Frameworks',
);

let dirs;
try {
  dirs = fs.readdirSync(frameworksDir, { withFileTypes: true });
} catch {
  process.exit(0);
}

for (const d of dirs) {
  if (!d.isDirectory() || !d.name.endsWith('.framework')) continue;

  const fw = path.join(frameworksDir, d.name);
  const verA = path.join(fw, 'Versions', 'A');
  if (!fs.existsSync(verA)) continue;

  const cur = path.join(fw, 'Versions', 'Current');
  try {
    fs.lstatSync(cur);
  } catch {
    fs.symlinkSync('A', cur);
  }

  let entries;
  try {
    entries = fs.readdirSync(verA);
  } catch {
    continue;
  }

  for (const ent of entries) {
    if (ent.startsWith('.')) continue;
    const linkPath = path.join(fw, ent);
    try {
      fs.lstatSync(linkPath);
    } catch {
      fs.symlinkSync(path.join('Versions', 'Current', ent), linkPath);
    }
  }
}

console.log('\n[Radio Sankt] postinstall: electron macOS framework symlinks checked.\n');
