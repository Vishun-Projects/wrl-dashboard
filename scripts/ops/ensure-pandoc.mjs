#!/usr/bin/env node
/** Download portable Pandoc if not present (vendor/pandoc-3.11/). */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PANDOC_EXE = path.join(__dirname, 'vendor/pandoc-3.11/pandoc.exe');
const PANDOC_VERSION = '3.11';
const ZIP_URL = `https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-windows-x86_64.zip`;

if (fs.existsSync(PANDOC_EXE)) {
  process.exit(0);
}

console.log(`Downloading Pandoc ${PANDOC_VERSION} → scripts/ops/vendor/ …`);
const vendorDir = path.join(__dirname, 'vendor');
const zipPath = path.join(vendorDir, 'pandoc.zip');
fs.mkdirSync(vendorDir, { recursive: true });
execSync(`curl -fsSL -o "${zipPath}" "${ZIP_URL}"`, { stdio: 'inherit' });
execSync(`unzip -qo "${zipPath}" -d "${vendorDir}"`, { stdio: 'inherit' });
fs.unlinkSync(zipPath);

if (!fs.existsSync(PANDOC_EXE)) {
  console.error('Pandoc download failed. Set PANDOC_PATH manually.');
  process.exit(1);
}
console.log('Pandoc ready:', PANDOC_EXE);
