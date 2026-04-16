const { execFileSync } = require('child_process');

const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

function runEvs(dir) {
  console.log(`[electron-builder][afterPack] EVS signing ${dir}`);
  execFileSync(PYTHON, ['-m', 'castlabs_evs.vmp', 'sign-pkg', dir], { stdio: 'inherit' });
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  runEvs(context.appOutDir);
};
