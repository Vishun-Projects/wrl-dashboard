import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['india-pincode'],
  outputFileTracingIncludes: {
    '/api/report/location-audit': [
      './node_modules/india-pincode/data/pincodes.json.gz',
    ],
    '/api/report/location-audit/stream': [
      './node_modules/india-pincode/data/pincodes.json.gz',
    ],
  },
};

export default nextConfig;
