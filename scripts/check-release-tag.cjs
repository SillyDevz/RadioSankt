const { execSync } = require('node:child_process');

function run(command) {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function readVersionFromRef(ref) {
  try {
    return JSON.parse(run(`git show ${ref}:package.json`)).version ?? null;
  } catch {
    return null;
  }
}

function main() {
  let upstream = '';
  try {
    upstream = run('git rev-parse --abbrev-ref --symbolic-full-name @{u}');
  } catch {
    return;
  }

  const upstreamVersion = readVersionFromRef(upstream);
  const headVersion = readVersionFromRef('HEAD');
  if (!upstreamVersion || !headVersion || upstreamVersion === headVersion) return;

  const expectedTag = `v${headVersion}`;
  const tagsOnHead = run('git tag --points-at HEAD')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

  // Accept both `v1.2.3` and `V1.2.3` on HEAD — some past releases used capital V.
  const matchesExpected = tagsOnHead.some((t) => t.toLowerCase() === expectedTag.toLowerCase());
  if (matchesExpected) return;

  console.error(`\nMissing release tag for version ${headVersion}.`);
  console.error(`Version changed from ${upstreamVersion} to ${headVersion}, but HEAD is not tagged ${expectedTag}.`);
  console.error(`Run: git tag ${expectedTag} && git push --tags\n`);
  process.exit(1);
}

main();
