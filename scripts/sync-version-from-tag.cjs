#!/usr/bin/env node
/**
 * Rewrites package.json (and package-lock.json) so their `version` field matches
 * the release tag. Invoked by the GitHub Actions release workflow right after
 * `npm ci` so electron-builder embeds the tagged version into the installer,
 * the app window title, `app.getVersion()`, and the auto-updater's latest.yml.
 *
 * Accepts either a CLI argument (`node sync-version-from-tag.cjs v1.0.19`) or the
 * GITHUB_REF_NAME environment variable, and tolerates a leading `v` or `V`.
 */
const fs = require('node:fs');
const path = require('node:path');

function parseVersion(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('No tag/version provided; pass one as CLI arg or set GITHUB_REF_NAME.');
  }
  const match = input.trim().match(/^[vV]?(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)$/);
  if (!match) {
    throw new Error(`"${input}" is not a semver tag (expected vX.Y.Z).`);
  }
  return match[1];
}

function patchJson(filePath, mutate) {
  const raw = fs.readFileSync(filePath, 'utf8');
  // Keep a trailing newline to match typical formatter output.
  const parsed = JSON.parse(raw);
  mutate(parsed);
  fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

function main() {
  const arg = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF;
  const version = parseVersion(arg?.replace(/^refs\/tags\//, '') ?? '');
  const root = path.resolve(__dirname, '..');

  const pkgPath = path.join(root, 'package.json');
  patchJson(pkgPath, (pkg) => {
    pkg.version = version;
  });

  const lockPath = path.join(root, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    patchJson(lockPath, (lock) => {
      lock.version = version;
      if (lock.packages && lock.packages['']) {
        lock.packages[''].version = version;
      }
    });
  }

  console.log(`[sync-version-from-tag] package version set to ${version}`);
}

try {
  main();
} catch (err) {
  console.error('[sync-version-from-tag]', err instanceof Error ? err.message : err);
  process.exit(1);
}
