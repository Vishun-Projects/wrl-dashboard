/**
 * Pack a Cadbury/Mondelez pipe-CSV into `.wrlmis` for faster upload/import.
 *
 * Usage:
 *   npx tsx scripts/mis-client/pack-import-file.ts path/to/VMSComplaintDetailsRpt.csv
 *   npx tsx scripts/mis-client/pack-import-file.ts path/to/file.csv -o out.wrlmis
 *   npm run mis-client:pack -- path/to/file.csv
 */
import { readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { packCsvBufferToWrlmis } from '@/features/mis-import/lib/wrlmis-pack';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function parseArgs(argv: string[]): { input: string; output: string | null; delimiter: string } {
  const args = argv.slice(2);
  let output: string | null = null;
  let delimiter = '|';
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-o' || a === '--output') {
      output = args[++i] ?? null;
      continue;
    }
    if (a === '-d' || a === '--delimiter') {
      delimiter = args[++i] ?? '|';
      continue;
    }
    if (a.startsWith('-')) {
      throw new Error(`Unknown flag: ${a}`);
    }
    positional.push(a);
  }
  if (positional.length !== 1) {
    throw new Error(
      'Usage: npx tsx scripts/mis-client/pack-import-file.ts <csv-path> [-o out.wrlmis] [-d "|"]'
    );
  }
  return { input: positional[0], output, delimiter };
}

function main() {
  const { input, output, delimiter } = parseArgs(process.argv);
  const inputPath = resolve(input);
  const csvBuffer = readFileSync(inputPath);
  const fileName = basename(inputPath);
  const outPath =
    output != null
      ? resolve(output)
      : join(dirname(inputPath), fileName.replace(/(\.[^.]+)?$/i, '.wrlmis'));

  const started = Date.now();
  const { packed, rowCount, sourceHint } = packCsvBufferToWrlmis(
    csvBuffer,
    fileName,
    delimiter
  );
  writeFileSync(outPath, packed);

  console.log(`Packed ${fileName}`);
  console.log(`  source hint : ${sourceHint}`);
  console.log(`  rows        : ${rowCount}`);
  console.log(`  csv size    : ${formatBytes(csvBuffer.length)}`);
  console.log(`  wrlmis size : ${formatBytes(packed.length)}`);
  console.log(
    `  ratio       : ${((packed.length / Math.max(csvBuffer.length, 1)) * 100).toFixed(1)}%`
  );
  console.log(`  elapsed     : ${Date.now() - started}ms`);
  console.log(`  output      : ${outPath}`);
  console.log('Upload the .wrlmis file in Client Import (Cadbury/Mondelez).');
}

main();
