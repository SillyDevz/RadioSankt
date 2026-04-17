const { execSync } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z\-_]{35}/,
  /ghp_[A-Za-z0-9]{36}/,
  /github_pat_[A-Za-z0-9_]{80,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /sk_(live|test)_[0-9A-Za-z]{16,}/,
  /-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----/,
  /(api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"\r\n]{8,}['"]/i,
];

const ALLOWLIST_FILES = new Set(['package-lock.json']);
const ALLOWLIST_LINE_HINTS = ['example', 'placeholder', 'changeme', 'dummy', 'sample', 'test'];

function getStagedFiles() {
  const output = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' }).trim();
  return output ? output.split('\n').map((x) => x.trim()).filter(Boolean) : [];
}

function getStagedPatch(file) {
  try {
    return execSync(`git diff --cached --unified=0 -- "${file}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1024 * 1024 * 5,
    });
  } catch {
    return '';
  }
}

function isProbablySafe(line) {
  const lowered = line.toLowerCase();
  return ALLOWLIST_LINE_HINTS.some((hint) => lowered.includes(hint));
}

function scanPatch(file, patch) {
  const issues = [];
  for (const rawLine of patch.split('\n')) {
    if (!rawLine.startsWith('+') || rawLine.startsWith('+++')) continue;
    const line = rawLine.slice(1);
    for (const pattern of PATTERNS) {
      if (pattern.test(line) && !isProbablySafe(line)) {
        issues.push({ file, line });
        break;
      }
    }
  }
  return issues;
}

function scanWorkingTree(files) {
  const issues = [];
  for (const file of files) {
    if (ALLOWLIST_FILES.has(file)) continue;
    const absolute = resolve(process.cwd(), file);
    if (!existsSync(absolute)) continue;
    const content = readFileSync(absolute, 'utf8');
    for (const pattern of PATTERNS) {
      const match = content.match(pattern);
      if (match && !isProbablySafe(match[0])) {
        issues.push({ file, line: match[0] });
        break;
      }
    }
  }
  return issues;
}

function main() {
  const stagedFiles = getStagedFiles();
  if (!stagedFiles.length) return;

  const patchIssues = stagedFiles
    .filter((file) => !ALLOWLIST_FILES.has(file))
    .flatMap((file) => scanPatch(file, getStagedPatch(file)));

  const fileIssues = scanWorkingTree(stagedFiles);
  const issues = [...patchIssues, ...fileIssues];
  if (!issues.length) return;

  console.error('\nSecret detection failed. Possible secret-like values found:\n');
  for (const issue of issues.slice(0, 10)) {
    console.error(`- ${issue.file}: ${issue.line.slice(0, 140)}`);
  }
  console.error('\nIf this is a false positive, replace it with a placeholder or remove it from the commit.\n');
  process.exit(1);
}

main();
