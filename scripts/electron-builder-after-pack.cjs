const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

function evsAuthArgs() {
  const name = process.env.CASTLABS_ACCOUNT_NAME?.trim();
  const pass = process.env.CASTLABS_ACCOUNT_PASSWORD?.trim();
  return name && pass ? ['-A', name, '-P', pass] : [];
}

function runEvs(dir) {
  console.log(`[electron-builder][afterPack] EVS signing ${dir}`);
  execFileSync(PYTHON, ['-m', 'castlabs_evs.vmp', 'sign-pkg', ...evsAuthArgs(), dir], { stdio: 'inherit' });
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(srcPath);
      try {
        fs.symlinkSync(target, destPath);
      } catch {
        // On Windows packaging paths, symlink creation can fail; fall back to copy.
        const realSource = fs.realpathSync.native(srcPath);
        fs.copyFileSync(realSource, destPath);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function ensureWindowsWidevine(context) {
  const src = path.join(context.packager.projectDir, 'node_modules', 'electron', 'dist', 'WidevineCdm');
  const dest = path.join(context.appOutDir, 'WidevineCdm');
  if (!fs.existsSync(src)) {
    console.warn('[electron-builder][afterPack] WidevineCdm source missing at:', src);
    return;
  }
  if (fs.existsSync(dest)) {
    console.log('[electron-builder][afterPack] WidevineCdm already present:', dest);
    return;
  }
  copyDirRecursive(src, dest);
  console.log('[electron-builder][afterPack] Copied WidevineCdm to:', dest);
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName === 'win32') {
    ensureWindowsWidevine(context);
    return;
  }
  if (context.electronPlatformName === 'darwin') {
    runEvs(context.appOutDir);
  }
};
