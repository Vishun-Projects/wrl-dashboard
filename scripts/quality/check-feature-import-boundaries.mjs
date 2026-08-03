#!/usr/bin/env node
/**
 * Feature/module layout guards (remediation roadmap + modules pilot).
 *
 * Hard fail:
 *  - retired @/lib/<domain> / @/components/<domain> paths
 *  - retired ARCP paths: @/features/arcp, @/lib/arcp, @/lib/read-model/arcp
 *  - src/shared → @/features or @/modules
 *  - src/lib → @/features unless listed in scripts/quality/boundary-lib-features-debt.txt
 *  - deep feature→feature / module→module imports (STRICT, default on)
 *
 * Soft (never fail alone):
 *  - allowlisted lib→features debt (inventory)
 *  - src/lib → @/modules (platform orchestrators call module sync; prefer barrels)
 *  - src/components → @/features or @/modules (UI may compose; prefer barrels)
 *
 * FEATURE_BOUNDARIES_STRICT=0 — cross-domain deep is advisory only
 * BOUNDARY_LIB_FEATURES=strict — also fail on allowlisted lib→features debt
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const srcRoot = join(root, 'src');
const featuresRoot = join(srcRoot, 'features');
const modulesRoot = join(srcRoot, 'modules');
const sharedRoot = join(srcRoot, 'shared');
const libRoot = join(srcRoot, 'lib');
const componentsRoot = join(srcRoot, 'components');
const debtFile = join(root, 'scripts', 'quality', 'boundary-lib-features-debt.txt');

const strict = process.env.FEATURE_BOUNDARIES_STRICT !== '0';
const libFeaturesStrict = process.env.BOUNDARY_LIB_FEATURES === 'strict';

const retired = [
  'mis-email',
  'serial-audit',
  'report',
  'register',
  'arcp-claims',
  'arcp',
  'mis-client-import',
  'location-audit',
  'warranty-master',
  'distribution',
  'performance',
];

const retiredLibRe = new RegExp(
  String.raw`from\s+['"]@/lib/(${retired.join('|')})(/|['"])`
);
const retiredCompRe = new RegExp(
  String.raw`from\s+['"]@/components/(location-audit|warranty-master|distribution|report)(/|['"])`
);
/** Migrated feature packages → modules (hard-fail old import paths). Add entries only after move. */
const retiredFeatureToModule = {
  arcp: 'modules/arcp',
  'warranty-master': 'modules/warranty',
  distribution: 'modules/call-distribution',
  'location-audit': 'modules/location-audit',
  'serial-audit': 'modules/serial-history',
  'mis-email': 'modules/mail-alerts',
  'major-repair-alerts': 'modules/mail-alerts',
  report: 'modules/mis',
  register: 'modules/mis/register',
  'mis-import': 'modules/mis/client-import',
};
const retiredFeatureRe = new RegExp(
  String.raw`from\s+['"]@/features/(${Object.keys(retiredFeatureToModule).join('|')})(/|['"])`
);
const retiredArcpReadModelRe = /from\s+['"]@\/lib\/read-model\/arcp(\/|['"])/;
/** Flat call-* leaves nested under lib/call/{display,register,row,status}. */
const retiredCallLibRe =
  /from\s+['"]@\/lib\/call-(display|register|row|status)(\/|['"])/;
/** SQL leaves moved to src/sql/<domain>. */
const retiredSqlLibRe = /from\s+['"]@\/lib\/(register-sql|trhcalls|repair)(\/|['"])/;
const retiredSqlReadModelQueriesRe = /from\s+['"]@\/lib\/read-model\/queries(\/|['"])/;
const retiredSqlModuleRe =
  /from\s+['"]@\/modules\/(warranty\/services\/sql|arcp\/services\/query|arcp\/server\/postgres|location-audit\/server\/queries|serial-history\/server\/sql-scope)(\/|['"])/;

const deepFeatureImport =
  /from\s+['"]@\/features\/([a-z0-9-]+)\/(lib|ui|components|services|server|hooks|pages|constants)\//;
const deepModuleImport =
  /from\s+['"]@\/modules\/([a-z0-9-]+)\/(lib|ui|components|services|server|hooks|pages|constants)\//;
const anyFeatureImport = /from\s+['"]@\/features\//;
const anyModuleImport = /from\s+['"]@\/modules\//;

function walk(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      out.push(...walk(p));
    } else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

function domainOf(file, domainRoot) {
  const rel = relative(domainRoot, file).split('\\').join('/');
  if (rel.startsWith('..')) return null;
  return rel.split('/')[0] || null;
}

function loadDebtSet() {
  if (!existsSync(debtFile)) return new Set();
  return new Set(
    readFileSync(debtFile, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('\\').join('/'))
  );
}

/** @type {string[]} */
const hard = [];
/** @type {string[]} */
const domainDeepSoft = [];
/** @type {string[]} */
const domainDeepUiSoft = [];
/** @type {string[]} */
const softStale = [];
/** @type {string[]} */
const libDebtHits = [];
/** @type {string[]} */
const libModuleHits = [];
/** @type {string[]} */
const componentHits = [];
/** @type {string[]} */
const componentDeepSoft = [];

const debt = loadDebtSet();
const debtHitPaths = new Set();

for (const file of walk(srcRoot)) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file).split('\\').join('/');
  for (const line of text.split(/\r?\n/)) {
    if (retiredLibRe.test(line) || retiredCompRe.test(line)) {
      hard.push(`${rel}: retired path\n  ${line.trim()}`);
    }
    const retiredFeat = line.match(retiredFeatureRe);
    if (retiredFeat) {
      const dest = retiredFeatureToModule[retiredFeat[1]];
      hard.push(
        `${rel}: retired @/features/${retiredFeat[1]} (use @/${dest})\n  ${line.trim()}`
      );
    }
    if (retiredArcpReadModelRe.test(line)) {
      hard.push(
        `${rel}: retired @/lib/read-model/arcp (use @/modules/arcp/server/sync)\n  ${line.trim()}`
      );
    }
    if (retiredCallLibRe.test(line)) {
      hard.push(
        `${rel}: retired @/lib/call-* (use @/lib/call/{display,register,row,status})\n  ${line.trim()}`
      );
    }
    if (retiredSqlLibRe.test(line)) {
      hard.push(
        `${rel}: retired @/lib/{register-sql,trhcalls,repair} (use @/sql/...)\n  ${line.trim()}`
      );
    }
    if (retiredSqlReadModelQueriesRe.test(line)) {
      hard.push(
        `${rel}: retired @/lib/read-model/queries (use @/sql/read-model)\n  ${line.trim()}`
      );
    }
    if (retiredSqlModuleRe.test(line)) {
      hard.push(`${rel}: retired module SQL path (use @/sql/<domain>)\n  ${line.trim()}`);
    }
  }
}

if (existsSync(sharedRoot)) {
  for (const file of walk(sharedRoot)) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(root, file).split('\\').join('/');
    for (const line of text.split(/\r?\n/)) {
      if (anyFeatureImport.test(line)) {
        hard.push(`${rel}: shared must not import features/\n  ${line.trim()}`);
      }
      if (anyModuleImport.test(line)) {
        hard.push(`${rel}: shared must not import modules/\n  ${line.trim()}`);
      }
    }
  }
}

if (existsSync(libRoot)) {
  for (const file of walk(libRoot)) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(root, file).split('\\').join('/');
    const featureLines = text.split(/\r?\n/).filter((l) => anyFeatureImport.test(l));
    const moduleLines = text.split(/\r?\n/).filter((l) => anyModuleImport.test(l));

    if (featureLines.length) {
      if (debt.has(rel)) {
        debtHitPaths.add(rel);
        for (const line of featureLines) libDebtHits.push(`${rel}\n  ${line.trim()}`);
        if (libFeaturesStrict) {
          for (const line of featureLines) {
            hard.push(`${rel}: lib→features (BOUNDARY_LIB_FEATURES=strict)\n  ${line.trim()}`);
          }
        }
      } else {
        for (const line of featureLines) {
          hard.push(
            `${rel}: lib must not import features/ (not in scripts/quality/boundary-lib-features-debt.txt)\n  ${line.trim()}`
          );
        }
      }
    }

    for (const line of moduleLines) {
      libModuleHits.push(`${rel}\n  ${line.trim()}`);
    }
  }
}

for (const entry of debt) {
  if (!debtHitPaths.has(entry)) {
    softStale.push(`stale debt allowlist entry (no longer imports features): ${entry}`);
  }
}

if (existsSync(componentsRoot)) {
  for (const file of walk(componentsRoot)) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(root, file).split('\\').join('/');
    for (const line of text.split(/\r?\n/)) {
      const hitsFeature = anyFeatureImport.test(line);
      const hitsModule = anyModuleImport.test(line);
      if (!hitsFeature && !hitsModule) continue;
      componentHits.push(`${rel}\n  ${line.trim()}`);
      const deepF = line.match(deepFeatureImport);
      if (deepF) {
        componentDeepSoft.push(
          `${rel}: components deep→features/${deepF[1]}/${deepF[2]} (prefer barrel)\n  ${line.trim()}`
        );
      }
      const deepM = line.match(deepModuleImport);
      if (deepM) {
        componentDeepSoft.push(
          `${rel}: components deep→modules/${deepM[1]}/${deepM[2]} (prefer barrel)\n  ${line.trim()}`
        );
      }
    }
  }
}

/**
 * @param {string} domainRoot
 * @param {'features' | 'modules'} kind
 * @param {RegExp} deepRe
 */
function scanDomainCrossImports(domainRoot, kind, deepRe) {
  if (!existsSync(domainRoot)) return;
  for (const file of walk(domainRoot)) {
    const self = domainOf(file, domainRoot);
    if (!self) continue;
    const text = readFileSync(file, 'utf8');
    const rel = relative(root, file).split('\\').join('/');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(deepRe);
      if (!m) continue;
      if (m[1] !== self) {
        // UI deep imports are intentional: barrels stay services-only so headless
        // CLIs (MIS email, sync-worker) do not pull React/components.
        if (m[2] === 'ui' || m[2] === 'components' || m[2] === 'pages') {
          domainDeepUiSoft.push(`${rel} → ${kind}/${m[1]}/${m[2]}\n  ${line.trim()}`);
        } else {
          domainDeepSoft.push(`${rel} → ${kind}/${m[1]}/${m[2]}\n  ${line.trim()}`);
        }
      }
    }
  }
}

scanDomainCrossImports(featuresRoot, 'features', deepFeatureImport);
scanDomainCrossImports(modulesRoot, 'modules', deepModuleImport);

// Cross-layer deep: features ↔ modules
if (existsSync(featuresRoot)) {
  for (const file of walk(featuresRoot)) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(root, file).split('\\').join('/');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(deepModuleImport);
      if (!m) continue;
      if (m[2] === 'ui' || m[2] === 'components' || m[2] === 'pages') {
        domainDeepUiSoft.push(`${rel} → modules/${m[1]}/${m[2]}\n  ${line.trim()}`);
      } else {
        domainDeepSoft.push(`${rel} → modules/${m[1]}/${m[2]}\n  ${line.trim()}`);
      }
    }
  }
}
if (existsSync(modulesRoot)) {
  for (const file of walk(modulesRoot)) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(root, file).split('\\').join('/');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(deepFeatureImport);
      if (!m) continue;
      if (m[2] === 'ui' || m[2] === 'components' || m[2] === 'pages') {
        domainDeepUiSoft.push(`${rel} → features/${m[1]}/${m[2]}\n  ${line.trim()}`);
      } else {
        domainDeepSoft.push(`${rel} → features/${m[1]}/${m[2]}\n  ${line.trim()}`);
      }
    }
  }
}

if (libDebtHits.length) {
  console.log(
    `Known lib→features debt: ${debtHitPaths.size} file(s), ${libDebtHits.length} import(s). Sample:`
  );
  for (const s of libDebtHits.slice(0, 6)) console.log(' ', s);
  if (libDebtHits.length > 6) console.log(`  … +${libDebtHits.length - 6} more`);
  console.log('  Clear with BOUNDARY_LIB_FEATURES=strict once inverted.\n');
}

if (libModuleHits.length) {
  console.log(
    `lib→modules: ${libModuleHits.length} import(s) (allowed for sync/orchestrators; prefer barrels). Sample:`
  );
  for (const s of libModuleHits.slice(0, 4)) console.log(' ', s);
  if (libModuleHits.length > 4) console.log(`  … +${libModuleHits.length - 4} more`);
  console.log('');
}

if (componentHits.length) {
  console.log(
    `components→features/modules: ${componentHits.length} import(s) (allowed; prefer barrels). Sample:`
  );
  for (const s of componentHits.slice(0, 4)) console.log(' ', s);
  if (componentHits.length > 4) console.log(`  … +${componentHits.length - 4} more`);
  console.log('');
}

if (componentDeepSoft.length) {
  console.log(
    `Advisory: ${componentDeepSoft.length} components deep→domain (prefer barrel).`
  );
  for (const s of componentDeepSoft.slice(0, 4)) console.log(' ', s);
  if (componentDeepSoft.length > 4) console.log(`  … +${componentDeepSoft.length - 4} more`);
  console.log('');
}

if (domainDeepUiSoft.length) {
  console.log(
    `Advisory: ${domainDeepUiSoft.length} deep cross-domain UI import(s) (barrels prefer services, not components). Sample:`
  );
  for (const s of domainDeepUiSoft.slice(0, 6)) console.log(' ', s);
  if (domainDeepUiSoft.length > 6) console.log(`  … +${domainDeepUiSoft.length - 6} more`);
  console.log('');
}

if (domainDeepSoft.length) {
  console.log(
    `Advisory: ${domainDeepSoft.length} deep cross-domain import(s) (target: index.ts only). Sample:`
  );
  for (const s of domainDeepSoft.slice(0, 8)) console.log(' ', s);
  if (domainDeepSoft.length > 8) console.log(`  … +${domainDeepSoft.length - 8} more`);
  console.log('');
}

if (softStale.length) {
  console.log(`Stale allowlist entries (${softStale.length}):`);
  for (const s of softStale) console.log(' ', s);
  console.log('');
}

if (hard.length) {
  console.error('Feature boundary hard failures:\n');
  for (const e of hard) console.error(e + '\n');
  process.exit(1);
}

if (strict && domainDeepSoft.length) {
  console.error(
    'Deep cross-domain imports are errors (set FEATURE_BOUNDARIES_STRICT=0 to warn only).'
  );
  process.exit(1);
}

console.log('check:feature-boundaries OK');
