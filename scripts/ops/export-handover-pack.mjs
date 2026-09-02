#!/usr/bin/env node
/**
 * Export WRLD handover pack: copy authored docs, generate API ref, RBAC xlsx/csv, git info.
 * Always writes docs/handover/; also writes HANDOVER_OUT (default: OneDrive WRLD).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { exportCompanyShareFormats } from './handover-office-formats.mjs';
import {
  fetchRbacSnapshot,
  buildRoleMatrixRows,
  buildRolePermissionsSheet,
  generateRolesSnapshotMarkdown,
} from './handover-rbac-from-db.mjs';
import { HANDOVER_PROD_URL } from './handover-constants.mjs';
import { generateDeliveryDocs } from './handover-portal-stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const REPO_HANDOVER = path.join(ROOT, 'docs/handover');
const ONEDRIVE_DEFAULT = 'C:/Users/Vishnu.Vishwakarma/OneDrive/Documents/WRLD';
const HANDOVER_OUT = process.env.HANDOVER_OUT || ONEDRIVE_DEFAULT;

const TECH_COPIES = [
  ['docs/ARCHITECTURE.md', '03-Technical/ARCHITECTURE.md'],
  ['docs/CODEBASE_STRUCTURE.md', '03-Technical/CODEBASE_STRUCTURE.md'],
  ['docs/PROD_READ_SOURCE.md', '05-Operations/PROD_READ_SOURCE.md'],
  ['docs/MAIL_SCHEDULE.md', '05-Operations/MAIL_SCHEDULE.md'],
  ['docs/SYNC_ENTRY_POINTS.md', '05-Operations/SYNC_ENTRY_POINTS.md'],
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

const COPY_BANNERS = {
  '03-Technical/ARCHITECTURE.md':
    '> **Status:** Ready (repo-generated). For printable diagrams see `07-Company-Share/PDF/03_Architecture_Diagrams.pdf`.\n\n',
  '03-Technical/CODEBASE_STRUCTURE.md':
    '> **Status:** Ready (repo-generated from `docs/CODEBASE_STRUCTURE.md`).\n\n',
  '05-Operations/PROD_READ_SOURCE.md':
    '> **Status:** Ready (repo-generated). **Confirm VPS `.env` on host** before sign-off — see `VPS_ENV_VERIFICATION_CHECKLIST.md`.\n\n',
  '05-Operations/MAIL_SCHEDULE.md':
    '> **Status:** Ready (repo-generated). Cron on VPS — verify with `crontab -l` on host.\n\n',
  '05-Operations/SYNC_ENTRY_POINTS.md':
    '> **Status:** Ready (repo-generated). systemd + npm entry points for ops.\n\n',
};

function copyFile(srcRel, destRel, outRoot) {
  const src = path.join(ROOT, srcRel);
  const dest = path.join(outRoot, destRel);
  if (!fs.existsSync(src)) {
    console.warn(`skip missing: ${srcRel}`);
    return;
  }
  ensureDir(path.dirname(dest));
  const banner = COPY_BANNERS[destRel] || '';
  let content = fs.readFileSync(src, 'utf8');
  if (banner && !content.includes('**Status:**')) {
    content = banner + content;
  }
  fs.writeFileSync(dest, content);
}

function copyDiagrams(outRoot) {
  const srcDir = path.join(ROOT, 'docs/diagrams');
  const destDir = path.join(outRoot, '03-Technical/diagrams');
  ensureDir(destDir);
  if (!fs.existsSync(srcDir)) return;
  const pngs = fs.readdirSync(srcDir).filter((f) => f.endsWith('.png'));
  for (const f of pngs) {
    fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
  }
  const index = [
    '# Diagram index',
    '',
    '> **Legibility:** Open PNGs here at full resolution, or use `07-Company-Share/PDF/03_Architecture_Diagrams.pdf` (wide diagrams on landscape pages).',
    '',
    'Regenerate PNGs: `node scripts/ops/export-mermaid-diagrams.mjs`.',
    '',
    '**Company share:** `07-Company-Share/Diagrams/`',
    '',
    ...pngs.sort().map((f) => `- ![${f}](${f})`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(destDir, 'README.md'), index);
}

function walkRoutes(dir, base = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const routes = [];
  for (const e of entries) {
    const rel = path.join(base, e.name);
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      routes.push(...walkRoutes(full, rel));
    } else if (e.name === 'route.ts') {
      const apiPath = '/api/' + base.split(path.sep).join('/');
      routes.push({ file: full, apiPath });
    }
  }
  return routes;
}

function extractExportedMethods(text) {
  const m = text.match(/export\s*\{([^}]+)\}/);
  if (!m) return [];
  const HTTP = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
  return m[1]
    .split(',')
    .map((s) => s.trim().split(/\s+/)[0])
    .filter((name) => HTTP.has(name));
}

function resolveHandler(routeFile) {
  const text = fs.readFileSync(routeFile, 'utf8');
  const m = text.match(/from\s+['"]@\/modules\/([^'"]+)['"]/);
  if (m) return `@/modules/${m[1]}`;
  const methods = extractExportedMethods(text);
  return methods.length ? `(inline) ${methods.join(',')}` : '(inline)';
}

function inferAuth(handlerPath, routeFile) {
  let file = routeFile;
  if (handlerPath.startsWith('@/modules/')) {
    const rel = handlerPath.replace('@/', 'src/') + '.ts';
    const candidate = path.join(ROOT, rel);
    if (fs.existsSync(candidate)) file = candidate;
    else {
      const dir = path.join(ROOT, handlerPath.replace('@/', 'src/'));
      if (fs.existsSync(dir)) {
        const ts = fs.readdirSync(dir).find((f) => f.endsWith('.ts'));
        if (ts) file = path.join(dir, ts);
      }
    }
  }
  if (!fs.existsSync(file)) return '—';
  const text = fs.readFileSync(file, 'utf8');
  const hints = [];
  const pageId = text.match(/pageId:\s*['"]([^'"]+)['"]/);
  const tabId = text.match(/tabId:\s*['"]([^'"]+)['"]/);
  const perm = text.match(/permission:\s*['"]([^'"]+)['"]/);
  const bearer = /resolveBearerSecurity|CRON_SECRET|Bearer/.test(text);
  if (pageId) hints.push(`page:${pageId[1]}`);
  if (tabId) hints.push(`tab:${tabId[1]}`);
  if (perm) hints.push(perm[1]);
  if (/canAccessPage\(/.test(text) && !pageId) hints.push('canAccessPage');
  if (/requirePageAccess|resolveApiAccess/.test(text)) hints.push('RBAC');
  if (bearer) hints.push('Bearer/cron');
  if (/getSession|createServerClient/.test(text)) hints.push('session');
  return hints.length ? hints.join(', ') : 'session';
}

function groupRoute(apiPath) {
  if (apiPath.startsWith('/api/auth')) return 'Auth';
  if (apiPath.startsWith('/api/profile')) return 'Profile / MIS email';
  if (apiPath.startsWith('/api/report')) return 'Reports';
  if (apiPath.startsWith('/api/admin')) return 'Admin';
  if (apiPath.startsWith('/api/read-model')) return 'Read model / sync';
  if (['/api/calls', '/api/comments', '/api/flags'].some((p) => apiPath.startsWith(p))) {
    return 'Calls / comments / flags';
  }
  return 'Other';
}

function generateApiReference() {
  const apiRoot = path.join(ROOT, 'src/app/api');
  const routes = walkRoutes(apiRoot);
  const rows = routes.map(({ file, apiPath }) => {
    const text = fs.readFileSync(file, 'utf8');
    const methods = extractExportedMethods(text);
    const handler = resolveHandler(file);
    const auth = inferAuth(handler, file);
    return { apiPath, methods: methods.join(', ') || '—', auth, handler, group: groupRoute(apiPath) };
  });
  rows.sort((a, b) => a.apiPath.localeCompare(b.apiPath));

  const lines = [
    '# API Reference',
    '',
    `Generated: ${new Date().toISOString().slice(0, 10)} from \`src/app/api/**/route.ts\`.`,
    '',
  ];
  let lastGroup = '';
  for (const r of rows) {
    if (r.group !== lastGroup) {
      lines.push(`## ${r.group}`, '', '| Method | Path | Auth | Handler |', '| --- | --- | --- | --- |');
      lastGroup = r.group;
    }
    lines.push(`| ${r.methods} | \`${r.apiPath}\` | ${r.auth} | ${r.handler} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function parseRbacCatalog() {
  const text = fs.readFileSync(path.join(ROOT, 'src/lib/auth/rbac-catalog.ts'), 'utf8');
  const pagesSection = text.slice(
    text.indexOf('export const RBAC_PAGES'),
    text.indexOf('export const RBAC_CAPABILITIES'),
  );
  const pages = [];
  const pageRe =
    /\{\s*id:\s*'([^']+)',\s*permission:\s*(?:'([^']+)'|SUPER_ADMIN_PERMISSION),\s*path:\s*'([^']+)',\s*label:\s*'([^']+)'([\s\S]*?)\n  \}/g;
  let m;
  while ((m = pageRe.exec(pagesSection)) !== null) {
    const tail = m[5];
    const groupM = tail.match(/group:\s*'([^']+)'/);
    const nav = /nav:\s*false/.test(tail) ? 'no' : 'yes';
    pages.push({
      permission: m[2] || 'super_admin',
      label: m[4],
      path: m[3],
      group: groupM?.[1] || '',
      nav,
    });
  }

  const tabs = [];
  const tabRe = /\{\s*id:\s*'([^']+)',\s*permission:\s*'([^']+)',\s*label:\s*'([^']+)'[^}]*parentPageId:\s*'([^']+)'/gs;
  while ((m = tabRe.exec(text)) !== null) {
    tabs.push({ permission: m[2], label: m[3], parent: m[4] });
  }

  const caps = [];
  const capRe = /permission:\s*'([^']+)',\s*label:\s*'([^']+)',\s*description:\s*'([^']*)'/gs;
  const capSection = text.slice(text.indexOf('RBAC_CAPABILITIES'));
  while ((m = capRe.exec(capSection)) !== null) {
    if (m[1].startsWith('page_')) continue;
    caps.push({ permission: m[1], label: m[2], description: m[3] });
  }

  return { pages, tabs, caps };
}

async function generateRbacFiles(outRoot) {
  const catalog = parseRbacCatalog();
  const { pages, tabs, caps } = catalog;
  const allPerms = [
    ...pages.map((p) => p.permission),
    ...tabs.map((t) => t.permission),
    ...caps.map((c) => c.permission),
  ];

  const snapshot = await fetchRbacSnapshot();
  const roleMatrix = buildRoleMatrixRows(allPerms, snapshot);
  const rolePermissions = buildRolePermissionsSheet(snapshot);
  const rolesSheet = snapshot.roles.map((r) => ({
    name: r.name,
    user_count: r.user_count,
    description: (r.description || '').trim(),
    permission_count: rolePermissions.filter((rp) => rp.role === r.name).length,
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rolesSheet), 'Roles');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(roleMatrix), 'RoleMatrix');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rolePermissions), 'RolePermissions');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pages), 'Pages');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tabs), 'MIS_Tabs');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(caps), 'Capabilities');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['How to use'],
      ['Exported', snapshot.exportedAt.slice(0, 19) + 'Z'],
      ['Source', 'Postgres app_roles + app_role_permissions (live)'],
      ['Roles UI', '/admin/roles'],
      ['RoleMatrix', 'Y = permission granted to role column'],
      ['Regenerate', 'npm run handover:export (requires DATABASE_URL)'],
    ]),
    'HowTo',
  );

  ensureDir(path.join(outRoot, '04-RBAC'));
  const xlsxPath = path.join(outRoot, '04-RBAC/RBAC_MATRIX.xlsx');
  const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  fs.writeFileSync(xlsxPath, xlsxBuf);

  const csvLines = ['role,permission'];
  for (const rp of rolePermissions) csvLines.push(`${rp.role},${rp.permission}`);
  fs.writeFileSync(path.join(outRoot, '04-RBAC/RBAC_MATRIX.csv'), csvLines.join('\n'));

  fs.writeFileSync(
    path.join(outRoot, '04-RBAC/ROLES_SNAPSHOT.md'),
    generateRolesSnapshotMarkdown(snapshot, catalog),
  );
}

function generateGitRelease() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  let remote = '';
  let branch = 'main';
  let recent = '';
  let describe = '';
  try {
    remote = execSync('git remote -v', { cwd: ROOT, encoding: 'utf8' }).trim();
    branch = execSync('git branch --show-current', { cwd: ROOT, encoding: 'utf8' }).trim() || 'main';
    recent = execSync('git log --oneline -20', { cwd: ROOT, encoding: 'utf8' }).trim();
    describe = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    /* ponytail: offline git ok */
  }

  return [
    '# Git and release',
    '',
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    '',
    '## Repository',
    '',
    '```',
    remote || '(no remote)',
    '```',
    '',
    `- **Default branch:** ${branch}`,
    `- **Package:** ${pkg.name}@${pkg.version}`,
    `- **Describe:** ${describe}`,
    '',
    '## Production',
    '',
    '- **App URL:** ' + HANDOVER_PROD_URL + ' (Vercel)',
    '- **VPS workers:** `scripts/vps-hosting/` (rsync + systemd + cron)',
    '',
    '## Key npm scripts',
    '',
    '| Script | Purpose |',
    '| --- | --- |',
    '| `npm run build` | Production build |',
    '| `npm run handover:export` | Regenerate this handover pack |',
    '| `npm run mis-email:*` | MIS mail ops |',
    '| `sync-worker:*` | Read-model sync (see SYNC_ENTRY_POINTS.md) |',
    '',
    '## Branch policy',
    '',
    'Feature branches → pull request → `main`. Deploy follows Vercel + VPS rsync.',
    '',
    '## Recent commits',
    '',
    '```',
    recent || '(no git history)',
    '```',
    '',
  ].join('\n');
}

const GENERATED_SKIP = new Set([
  '03-Technical/API_REFERENCE.md',
  '03-Technical/GIT_AND_RELEASE.md',
  '04-RBAC/RBAC_MATRIX.xlsx',
  '04-RBAC/RBAC_MATRIX.csv',
  '04-RBAC/ROLES_SNAPSHOT.md',
  '06-Delivery/SYSTEM_VERIFICATION.md',
  '06-Delivery/DELIVERY_STATEMENT.md',
]);

function copyAuthoredTree(srcRoot, destRoot) {
  if (!fs.existsSync(srcRoot)) return;
  const skipRel = (rel) => {
    const norm = rel.replace(/\\/g, '/');
    return (
      norm.startsWith('07-Company-Share') ||
      norm.endsWith('.zip') ||
      norm.includes('/.tmp-') ||
      GENERATED_SKIP.has(norm)
    );
  };
  const walk = (dir, rel = '') => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const relPath = path.join(rel, name);
      if (skipRel(relPath.replace(/\\/g, '/'))) continue;
      if (fs.statSync(full).isDirectory()) {
        walk(full, relPath);
      } else {
        const dest = path.join(destRoot, relPath);
        ensureDir(path.dirname(dest));
        try {
          fs.copyFileSync(full, dest);
        } catch (e) {
          if (e.code === 'EBUSY') console.warn(`  skip locked: ${relPath}`);
          else throw e;
        }
      }
    }
  };
  walk(srcRoot);
}

async function exportTo(outRoot) {
  console.log(`Exporting handover pack → ${outRoot}`);
  ensureDir(outRoot);

  for (const [src, dest] of TECH_COPIES) copyFile(src, dest, outRoot);
  copyDiagrams(outRoot);

  const knownIssues = path.join(REPO_HANDOVER, '05-Operations/KNOWN_ISSUES_AND_LIMITATIONS.md');
  if (fs.existsSync(knownIssues)) {
    copyFile(
      'docs/handover/05-Operations/KNOWN_ISSUES_AND_LIMITATIONS.md',
      '05-Operations/KNOWN_ISSUES_AND_LIMITATIONS.md',
      outRoot,
    );
  }

  fs.writeFileSync(path.join(outRoot, '03-Technical/API_REFERENCE.md'), generateApiReference());
  fs.writeFileSync(path.join(outRoot, '03-Technical/GIT_AND_RELEASE.md'), generateGitRelease());

  const catalog = parseRbacCatalog();
  const apiRouteCount = walkRoutes(path.join(ROOT, 'src/app/api')).length;
  await generateRbacFiles(outRoot);
  await generateDeliveryDocs(outRoot, catalog, apiRouteCount);

  copyAuthoredTree(REPO_HANDOVER, outRoot);
}

function cleanupTmpArtifacts(outRoot) {
  const pdfDir = path.join(outRoot, '07-Company-Share/PDF');
  const wordDir = path.join(outRoot, '07-Company-Share/Word');
  for (const dir of [pdfDir, wordDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('.tmp-')) fs.unlinkSync(path.join(dir, f));
    }
  }
}

async function main() {
  await exportTo(REPO_HANDOVER);
  if (path.resolve(HANDOVER_OUT) !== path.resolve(REPO_HANDOVER)) {
    await exportTo(HANDOVER_OUT);
  }

  console.log('Generating company-share PDF + Word…');
  await exportCompanyShareFormats(REPO_HANDOVER);
  cleanupTmpArtifacts(REPO_HANDOVER);
  if (path.resolve(HANDOVER_OUT) !== path.resolve(REPO_HANDOVER)) {
    await exportCompanyShareFormats(HANDOVER_OUT);
    cleanupTmpArtifacts(HANDOVER_OUT);
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
