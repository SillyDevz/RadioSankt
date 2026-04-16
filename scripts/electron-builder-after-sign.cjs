const path = require('path');
const { execFileSync } = require('child_process');
const { notarize } = require('@electron/notarize');

const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

function evsAuthArgs() {
  const name = process.env.CASTLABS_ACCOUNT_NAME?.trim();
  const pass = process.env.CASTLABS_ACCOUNT_PASSWORD?.trim();
  return name && pass ? ['-A', name, '-P', pass] : [];
}

function runEvs(dir) {
  console.log(`[electron-builder][afterSign] EVS signing ${dir}`);
  execFileSync(PYTHON, ['-m', 'castlabs_evs.vmp', 'sign-pkg', ...evsAuthArgs(), dir], { stdio: 'inherit' });
}

function env(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

module.exports = async function afterSign(context) {
  if (context.electronPlatformName === 'win32') {
    runEvs(context.appOutDir);
    return;
  }

  if (context.electronPlatformName !== 'darwin') return;

  const appleId = env('APPLE_ID');
  const appleIdPassword = env('APPLE_APP_SPECIFIC_PASSWORD');
  const teamId = env('APPLE_TEAM_ID');

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn('[electron-builder][afterSign] Skipping notarization; Apple credentials are not configured.');
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`[electron-builder][afterSign] Notarizing ${appPath}`);
  await notarize({
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });
};
