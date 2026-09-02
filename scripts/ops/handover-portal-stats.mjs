/**
 * Portal facts for handover delivery docs (DB + catalog + git).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fetchRbacSnapshot } from './handover-rbac-from-db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
import { HANDOVER_PROD_URL } from './handover-constants.mjs';

const PROD_URL = HANDOVER_PROD_URL;

export function collectPortalStats({ catalog, apiRouteCount }) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  let gitHead = '';
  let branch = 'main';
  try {
    gitHead = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    branch = execSync('git branch --show-current', { cwd: ROOT, encoding: 'utf8' }).trim() || 'main';
  } catch {
    /* offline ok */
  }

  const { pages, tabs } = catalog;
  const _navPages = pages.filter((p) => p.nav !== 'no');

  return {
    exportedAt: new Date().toISOString(),
    prodUrl: PROD_URL,
    packageName: pkg.name,
    packageVersion: pkg.version,
    gitHead,
    branch,
    apiRouteCount,
    pageCount: pages.length,
    navPageCount: pages.filter((p) => p.nav !== 'no').length,
    tabCount: tabs.length,
    opsDocs: [
      '05-Operations/PROD_READ_SOURCE.md',
      '05-Operations/MAIL_SCHEDULE.md',
      '05-Operations/SYNC_ENTRY_POINTS.md',
    ],
  };
}

export async function fetchPortalStats(catalog, apiRouteCount) {
  const snapshot = await fetchRbacSnapshot();
  const stats = collectPortalStats({ catalog, apiRouteCount });
  const totalUsers = snapshot.roles.reduce((n, r) => n + r.user_count, 0);
  const rolesWithUsers = snapshot.roles.filter((r) => r.user_count > 0);

  return { snapshot, stats, totalUsers, rolesWithUsers };
}

export function generateSystemVerificationMarkdown({ snapshot, stats, totalUsers, rolesWithUsers }) {
  const date = stats.exportedAt.slice(0, 10);
  const lines = [
    '# System verification — WRL Portal',
    '',
    `> **Generated:** ${stats.exportedAt.slice(0, 19)}Z · Regenerate: \`npm run handover:export\``,
    '',
    'Factual snapshot of the **production** portal configuration. VPS host checks require SSH — see [`VPS_ENV_VERIFICATION_CHECKLIST.md`](../05-Operations/VPS_ENV_VERIFICATION_CHECKLIST.md).',
    '',
    '## Production identity',
    '',
    '| Item | Value |',
    '| --- | --- |',
    `| Portal URL | ${stats.prodUrl} |`,
    `| Package | ${stats.packageName}@${stats.packageVersion} |`,
    `| Git | \`${stats.gitHead || '—'}\` on \`${stats.branch}\` |`,
    `| Export date | ${date} |`,
    '',
    '## Portal users and roles (live DB)',
    '',
    '| Metric | Count |',
    '| --- | ---: |',
    `| Active portal users | ${totalUsers} |`,
    `| Configured roles | ${snapshot.roles.length} |`,
    `| Roles with assigned users | ${rolesWithUsers.length} |`,
    `| Role-permission grants | ${snapshot.grants.length} |`,
    '',
    '### Users per role',
    '',
    '| Role | Users |',
    '| --- | ---: |',
  ];

  for (const r of snapshot.roles) {
    if (r.user_count > 0) lines.push(`| ${r.name} | ${r.user_count} |`);
  }
  if (!rolesWithUsers.length) lines.push('| _(none)_ | 0 |');

  lines.push(
    '',
    'Full permission lists: [`04-RBAC/ROLES_SNAPSHOT.md`](../04-RBAC/ROLES_SNAPSHOT.md) · Excel: [`RBAC_MATRIX.xlsx`](../04-RBAC/RBAC_MATRIX.xlsx).',
    '',
    '## Application surface (from codebase)',
    '',
    '| Item | Count |',
    '| --- | ---: |',
    `| RBAC pages (catalog) | ${stats.pageCount} |`,
    `| Sidebar nav pages | ${stats.navPageCount} |`,
    `| MIS tabs | ${stats.tabCount} |`,
    `| API routes | ${stats.apiRouteCount} |`,
    '',
    '## Documentation present in handover pack',
    '',
  );

  for (const doc of stats.opsDocs) {
    lines.push(`- [ ] \`${doc}\` included in pack`);
  }
  lines.push(
    '- [ ] `03-Technical/API_REFERENCE.md` auto-generated from routes',
    '- [ ] `04-RBAC/RBAC_MATRIX.xlsx` exported from production DB',
    '',
    '## VPS / ops (requires SSH to confirm)',
    '',
    'Complete on the production host:',
    '',
    '- [ ] [`VPS_ENV_VERIFICATION_CHECKLIST.md`](../05-Operations/VPS_ENV_VERIFICATION_CHECKLIST.md)',
    '- [ ] `READ_*_FROM=postgres` flags match [`PROD_READ_SOURCE.md`](../05-Operations/PROD_READ_SOURCE.md)',
    '- [ ] Cron: `mail-scheduler.sh`, sync workers per [`MAIL_SCHEDULE.md`](../05-Operations/MAIL_SCHEDULE.md) and [`SYNC_ENTRY_POINTS.md`](../05-Operations/SYNC_ENTRY_POINTS.md)',
    '- [ ] Postgres backup procedure — **not documented in repo**; ops to define (see [`docs/sync.md`](../../sync.md) rollback note)',
    '',
    '## Related',
    '',
    '- [`DELIVERY_STATEMENT.md`](DELIVERY_STATEMENT.md) — deliverables and sign-off request',
    '- [`FMS_Functional_Module_Spec.md`](../02-Functional/FMS_Functional_Module_Spec.md)',
    '',
  );

  return lines.join('\n');
}

export function generateDeliveryStatementMarkdown({ snapshot, stats, totalUsers }) {
  const _date = stats.exportedAt.slice(0, 10);
  const roleList = snapshot.roles
    .filter((r) => r.user_count > 0)
    .map((r) => `${r.name} (${r.user_count})`)
    .join(', ');

  return [
    '# Delivery statement — WRL Portal',
    '',
    `> **Generated:** ${stats.exportedAt.slice(0, 19)}Z · Production: ${stats.prodUrl}`,
    '',
    '## Delivered scope',
    '',
    '| Area | Delivered capability |',
    '| --- | --- |',
    '| **Reporting** | MIS (Summary, Register, Accounts, BD-MIS, Deployment, Client Import), Call Distribution, ARCP, Serial/Location/Warranty audits, Cancelled Calls, Athena reconciliation |',
    '| **Mail & alerts** | MIS digests, major-repair alerts, cancelled-call digests, subcontractor stock reconciliation |',
    '| **Administration** | Users, roles/RBAC, Mail & Alerts hub, read-model sync, service-call activity, performance insights, security audit log |',
    '| **Platform** | Supabase auth, office-scoped data, Vercel app + VPS workers |',
    '| **Documentation** | Handover pack (BRD, FMS, Architecture, API ref, live RBAC matrix, ops runbooks) |',
    '',
    '## Production facts (export snapshot)',
    '',
    '| Item | Value |',
    '| --- | --- |',
    `| Portal URL | ${stats.prodUrl} |`,
    `| Active users | ${totalUsers} |`,
    `| Configured roles | ${snapshot.roles.length} |`,
    `| Roles in use | ${roleList || '—'} |`,
    `| API routes | ${stats.apiRouteCount} |`,
    `| Git revision | \`${stats.gitHead || '—'}\` |`,
    '',
    '## Suggested email to request sign-off',
    '',
    '**To:** Rakesh, VP',
    '**Cc:** Sunil, delivery team',
    '**Subject:** WRL Portal — handover documentation and acceptance request',
    '',
    'Dear Rakesh,',
    '',
    'Please find attached the **WRL Portal** handover pack for Western Refrigeration.',
    '',
    '| Item | Detail |',
    '| --- | --- |',
    `| **Production** | ${stats.prodUrl} |`,
    `| **Active users** | ${totalUsers} across ${snapshot.roles.filter((r) => r.user_count > 0).length} roles |`,
    '| **Scope** | MIS reporting, audit registers, mail digests, subcontractor reconciliation, user/role admin |',
    '| **Documentation** | `07-Company-Share/` (PDF + Word + RBAC Excel) |',
    '',
    '**Attached / linked:**',
    '',
    '1. Closure summary + BRD + Scope summary',
    '2. Functional module spec + Admin user guide + Architecture diagrams (PDF)',
    '3. Known issues and limitations + ops runbooks',
    `4. RBAC matrix (Excel) — ${snapshot.roles.length} roles, live from production DB`,
    '',
    '**Ops verification:** VPS environment checklist should be completed on the production host before final sign-off.',
    '',
    '**We request confirmation** that the delivered scope is accepted, or a list of outstanding items with owners and dates.',
    '',
    'Regards,',
    '_[Delivery team]_',
    '',
    '---',
    '',
    '## Sign-off (complete when received)',
    '',
    '| Field | Value |',
    '| --- | --- |',
    '| **From** | |',
    '| **Date** | |',
    '| **Accepted** | [ ] Yes  [ ] Yes with conditions  [ ] No |',
    '',
    '**Conditions / follow-ups:**',
    '',
    '| # | Item | Owner | Due |',
    '| --- | --- | --- | --- |',
    '| 1 | | | |',
    '',
    '## Related',
    '',
    '- [`SYSTEM_VERIFICATION.md`](SYSTEM_VERIFICATION.md)',
    '- [`CLOSURE_SUMMARY.md`](../00-Index/CLOSURE_SUMMARY.md)',
    '- [`BRD_WRL_Portal.md`](../01-Business/BRD_WRL_Portal.md)',
    '',
  ].join('\n');
}

export async function generateDeliveryDocs(outRoot, catalog, apiRouteCount) {
  const data = await fetchPortalStats(catalog, apiRouteCount);
  ensureDir(path.join(outRoot, '06-Delivery'));

  fs.writeFileSync(
    path.join(outRoot, '06-Delivery/SYSTEM_VERIFICATION.md'),
    generateSystemVerificationMarkdown(data),
  );
  fs.writeFileSync(
    path.join(outRoot, '06-Delivery/DELIVERY_STATEMENT.md'),
    generateDeliveryStatementMarkdown(data),
  );
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
