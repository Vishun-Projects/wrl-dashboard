import pincodeMapData from './pincode_map.json';

export type PincodeMapEntry = {
  s?: string;
  d?: string;
};

/** Pincode → state/district lookup (~1.4MB JSON, bundled for Vercel serverless). */
export function getPincodeMapData(): Record<string, PincodeMapEntry> {
  return pincodeMapData as Record<string, PincodeMapEntry>;
}
