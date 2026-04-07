/**
 * Runs Castlabs EVS `sign-pkg` on electron-builder output under release/.
 * macOS: VMP must run before Apple code signing if you use a signing identity — adjust your pipeline if needed.
 * Linux: EVS does not sign; exits 0.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const release = path.join(root, 'release');

function sign(dir) {
  console.log(`[evs:sign-release] python3 -m castlabs_evs.vmp sign-pkg "${dir}"`);
  execSync(`python3 -m castlabs_evs.vmp sign-pkg "${dir}"`, { stdio: 'inherit', cwd: root });
}

if (!fs.existsSync(release)) {
  console.error('[evs:sign-release] No release/ folder. Run electron:build (or electron:build:mac / :win) first.');
  process.exit(1);
}

const platform = process.platform;
if (platform === 'linux') {
  console.log('[evs:sign-release] EVS does not apply to Linux Widevine packages. Skipping.');
  process.exit(0);
}

const entries = fs.readdirSync(release, { withFileTypes: true });

if (platform === 'darwin') {
  let signed = 0;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(release, e.name);
    let apps;
    try {
      apps = fs.readdirSync(dir).filter((f) => f.endsWith('.app'));
    } catch {
      continue;
    }
    if (apps.length > 0) {
      sign(dir);
      signed += 1;
    }
  }
  if (signed === 0) {
    console.error('[evs:sign-release] No .app bundle found under release/. Did the mac build finish?');
    process.exit(1);
  }
  process.exit(0);
}

if (platform === 'win32') {
  const winUnpacked = path.join(release, 'win-unpacked');
  if (fs.existsSync(winUnpacked)) {
    sign(winUnpacked);
    process.exit(0);
  }
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.toLowerCase().includes('win')) continue;
    const dir = path.join(release, e.name);
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    if (files.some((f) => f.endsWith('.exe'))) {
      sign(dir);
      process.exit(0);
    }
  }
  console.error('[evs:sign-release] No win-unpacked (or Windows build dir) found under release/.');
  process.exit(1);
}

console.error('[evs:sign-release] Unsupported platform:', platform);
process.exit(1);
