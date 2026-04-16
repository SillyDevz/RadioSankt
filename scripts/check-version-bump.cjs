const { execSync } = require('node:child_process');

const RELEASE_PATHS = [/^src\//, /^electron-builder\.yml$/, /^package\.json$/];

function getStagedFiles() {
  const output = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' }).trim();
  return output ? output.split('\n').map((x) => x.trim()).filter(Boolean) : [];
}

function readVersionFromGitRef(ref) {
  try {
    const content = execSync(`git show ${ref}:package.json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(content).version ?? null;
  } catch {
    return null;
  }
}

function hasReleaseAffectingChanges(files) {
  return files.some((file) => RELEASE_PATHS.some((pattern) => pattern.test(file))) && files.some((file) => file !== 'package.json');
}

function main() {
  const stagedFiles = getStagedFiles();
  if (!stagedFiles.length || !hasReleaseAffectingChanges(stagedFiles)) return;

  const previousVersion = readVersionFromGitRef('HEAD');
  const stagedVersion = readVersionFromGitRef(':');
  if (!previousVersion || !stagedVersion || previousVersion !== stagedVersion) return;

  console.error('\nVersion bump required: release-impacting changes are staged but package.json version did not change.');
  console.error('Run: npm version patch|minor|major (or update package.json version manually), then commit again.\n');
  process.exit(1);
}

main();
