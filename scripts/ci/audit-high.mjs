import { execSync } from 'node:child_process';

const ALLOWLIST_PACKAGES = new Set(['xlsx']);
const FAIL_SEVERITIES = new Set(['high', 'critical']);

function runAuditJson() {
  try {
    return execSync('npm audit --json', {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (err) {
    return err?.stdout?.toString?.() ?? '';
  }
}

const raw = runAuditJson();
let report;
try {
  report = JSON.parse(raw);
} catch {
  console.error('Could not parse npm audit JSON output');
  process.exit(1);
}

const vulnerabilities = report?.vulnerabilities ?? {};
const blocking = [];

for (const [name, vuln] of Object.entries(vulnerabilities)) {
  const severity = String(vuln?.severity ?? '').toLowerCase();
  if (!FAIL_SEVERITIES.has(severity)) continue;
  if (ALLOWLIST_PACKAGES.has(name)) continue;
  blocking.push({ name, severity, via: vuln?.via });
}

if (blocking.length > 0) {
  console.error('Blocking high/critical vulnerabilities detected:');
  for (const issue of blocking) {
    console.error(`- ${issue.name} (${issue.severity})`);
  }
  process.exit(1);
}

console.log('Audit check passed for high/critical vulnerabilities (allowlist applied).');
