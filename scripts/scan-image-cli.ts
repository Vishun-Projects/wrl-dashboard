import fs from 'fs';
import { scanImage } from '../src/lib/barcode-scan/scan-image';

async function main() {
  const path = process.argv[2];
  const target = process.argv[3] || '';
  if (!path) {
    console.error('Usage: npx tsx scripts/scan-image-cli.ts <image> [targetBarcode]');
    process.exit(1);
  }
  const buf = fs.readFileSync(path);
  const result = await scanImage(buf, target || undefined);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
