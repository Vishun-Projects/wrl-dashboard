#!/usr/bin/env node
/**
 * Feature layout guards (remediation roadmap).
 *
 * Hard fail:
 *  - retired @/lib/<domain> / @/components/<domain> paths
 *  - src/shared → @/features
 *  - src/lib → @/features unless listed in scripts/boundary-lib-features-debt.txt
 *  - deep feature→feature imports (STRICT, default on)
 *
 * Soft (never fail alone):
 *  - allowlisted lib→features debt (inventory)
 *  - src/components → @/features (UI may compose features; prefer barrels)
 *
 * FEATURE_BOUNDARIES_STRICT=0 — feature→feature deep is advisory only
 * BOUNDARY_LIB_FEATURES=strict — also fail on allowlisted lib debt
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const srcRoot = join(root, 'src');
const featuresRoot = join(srcRoot, 'features');
const sharedRoot = join(srcRoot, 'shared');
const libRoot = join(srcRoot, 'lib');
const componentsRoot = join(srcRoot, 'components');
const debtFile = join(root, 'scripts', 'boundary-lib-features-debt.txt');

const strict = process.env.FEATURE_BOUNDARIES_STRICT !== '0';
const libFeaturesStrict = process.env.BOUNDARY_LIB_FEATURES === 'strict';

const retired = [
  'mis-email',
  'serial-audit',
  'report',
  'register',
  'arcp-claims',
  'mis-client-import',
  'location-audit',
  'warranty-master',
  'distribution',
];

const retiredLibRe = new RegExp(
  String.raw`from\s+['"]@/lib/(${retired.join('|')})(/|['"])`
);
const retiredCompRe = new RegExp(
  String.raw`from\s+['"]@/components/(location-audit|warranty-master|distribution|report)(/|['"])`
);
const deepImport = /from\s+['"]@\/features\/([a-z0-9-]+)\/(lib|ui|server|hooks)\//;
const anyFeatureImport = /from\s+['"]@\/features\//;

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

function featureOf(file) {
  const rel = relative(featuresRoot, file).split('\\').join('/');
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
const featureDeepSoft = [];
/** @type {string[]} */
const softStale = [];
/** @type {string[]} */
const libDebtHits = [];
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
    }
  }
}

if (existsSync(libRoot)) {
  for (const file of walk(libRoot)) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(root, file).split('\\').join('/');
    const lines = text.split(/\r?\n/).filter((l) => anyFeatureImport.test(l));
    if (!lines.length) continue;

    if (debt.has(rel)) {
      debtHitPaths.add(rel);
      for (const line of lines) libDebtHits.push(`${rel}\n  ${line.trim()}`);
      if (libFeaturesStrict) {
        for (const line of lines) {
          hard.push(`${rel}: lib→features (BOUNDARY_LIB_FEATURES=strict)\n  ${line.trim()}`);
        }
      }
    } else {
      for (const line of lines) {
        hard.push(
          `${rel}: lib must not import features/ (not in scripts/boundary-lib-features-debt.txt)\n  ${line.trim()}`
        );
      }
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
      if (!anyFeatureImport.test(line)) continue;
      componentHits.push(`${rel}\n  ${line.trim()}`);
      const deep = line.match(deepImport);
      if (deep) {
        componentDeepSoft.push(
          `${rel}: components deep→features/${deep[1]}/${deep[2]} (prefer barrel)\n  ${line.trim()}`
        );
      }
    }
  }
}

if (existsSync(featuresRoot)) {
  for (const file of walk(featuresRoot)) {
    const self = featureOf(file);
    if (!self) continue;
    const text = readFileSync(file, 'utf8');
    const rel = relative(root, file).split('\\').join('/');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(deepImport);
      if (!m) continue;
      if (m[1] !== self) {
        featureDeepSoft.push(`${rel} → features/${m[1]}/${m[2]}\n  ${line.trim()}`);
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

if (componentHits.length) {
  console.log(
    `components→features: ${componentHits.length} import(s) (allowed; prefer barrels). Sample:`
  );
  for (const s of componentHits.slice(0, 4)) console.log(' ', s);
  if (componentHits.length > 4) console.log(`  … +${componentHits.length - 4} more`);
  console.log('');
}

if (componentDeepSoft.length) {
  console.log(
    `Advisory: ${componentDeepSoft.length} components deep→features (prefer @/features/<domain>).`
  );
  for (const s of componentDeepSoft.slice(0, 4)) console.log(' ', s);
  if (componentDeepSoft.length > 4) console.log(`  … +${componentDeepSoft.length - 4} more`);
  console.log('');
}

if (featureDeepSoft.length) {
  console.log(
    `Advisory: ${featureDeepSoft.length} deep cross-feature import(s) (target: index.ts only). Sample:`
  );
  for (const s of featureDeepSoft.slice(0, 8)) console.log(' ', s);
  if (featureDeepSoft.length > 8) console.log(`  … +${featureDeepSoft.length - 8} more`);
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

if (strict && featureDeepSoft.length) {
  console.error(
    'Deep cross-feature imports are errors (set FEATURE_BOUNDARIES_STRICT=0 to warn only).'
  );
  process.exit(1);
}

console.log('check:feature-boundaries OK');
