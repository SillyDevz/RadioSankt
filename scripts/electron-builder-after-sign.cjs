const path = require('path');
const { notarize } = require('@electron/notarize');

function env(name) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

module.exports = async function afterSign(context) {
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
