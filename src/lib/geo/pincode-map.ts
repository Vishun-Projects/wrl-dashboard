import fs from 'fs';
import path from 'path';

export type PincodeMapEntry = {
  s?: string;
  d?: string;
};

let cachedPincodeMap: Record<string, PincodeMapEntry> | null = null;

/** Load pincode map at runtime instead of bundling ~1.4MB JSON into server chunks. */
export function getPincodeMapData(): Record<string, PincodeMapEntry> {
  if (cachedPincodeMap) return cachedPincodeMap;
  const filePath = path.join(process.cwd(), 'src/app/report/distribution/pincode_map.json');
  cachedPincodeMap = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, PincodeMapEntry>;
  return cachedPincodeMap;
}
