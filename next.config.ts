import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const appDir = path.dirname(fileURLToPath(import.meta.url));

const withBundleAnalyzer =
  process.env.ANALYZE === 'true'
    ? require('@next/bundle-analyzer')({ enabled: true })
    : (config: NextConfig) => config;

const isDev = process.env.NODE_ENV === 'development';

function supabaseConnectOrigins(): string[] {
  const origins: string[] = [
    'https://*.supabase.co',
    'wss://*.supabase.co',
    'https://api.wrl-fsm.cloud',
    'wss://api.wrl-fsm.cloud',
  ];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (url) {
    try {
      const parsed = new URL(url);
      origins.push(parsed.origin);
      if (parsed.protocol === 'https:') {
        origins.push(`wss://${parsed.host}`);
      }
    } catch {
      /* ignore invalid env URL */
    }
  }
  return [...new Set(origins)];
}

function buildContentSecurityPolicy(): string {
  const vercelAnalytics = 'https://va.vercel-scripts.com';
  const scriptSrc = isDev
    ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live ${vercelAnalytics}`
    : `script-src 'self' 'unsafe-inline' https://vercel.live ${vercelAnalytics}`;

  const connectParts = ["connect-src 'self'", vercelAnalytics, ...supabaseConnectOrigins()];
  if (isDev) {
    // Turbopack HMR + local API during `next dev`
    connectParts.push('ws://localhost:*', 'http://localhost:*', 'ws://127.0.0.1:*');
  }

  return [
    "default-src 'self'",
    scriptSrc,
    connectParts.join(' '),
    "img-src 'self' data: https: blob:",
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "font-src 'self' data:",
    "frame-src 'self' blob: https://vercel.live",
  ].join('; ');
}

function buildSecurityHeaders() {
  const headers = [
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    {
      key: 'Content-Security-Policy',
      value: buildContentSecurityPolicy(),
    },
  ];

  // HSTS on http://localhost causes confusing browser behaviour in dev
  if (!isDev) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    });
  }

  return headers;
}

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(appDir),
  },
  serverExternalPackages: [
    '@zxing/library',
    'india-pincode',
    'jimp',
    'sharp',
    'tesseract.js',
    'tesseract.js-core',
    'wasm-feature-detect',
  ],
  /** india-pincode is externalized (loads data via __dirname); Vercel must ship dist + dataset. */
  outputFileTracingIncludes: {
    '/api/report/location-audit': [
      './node_modules/india-pincode/package.json',
      './node_modules/india-pincode/dist/index.js',
      './node_modules/india-pincode/dist/index.mjs',
      './node_modules/india-pincode/data/pincodes.json.gz',
    ],
    '/api/report/location-audit/stream': [
      './node_modules/india-pincode/package.json',
      './node_modules/india-pincode/dist/index.js',
      './node_modules/india-pincode/dist/index.mjs',
      './node_modules/india-pincode/data/pincodes.json.gz',
    ],
    '/api/barcode-scan/read-image': [
      './node_modules/tesseract.js/src/worker-script/node/index.js',
      './node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
      './node_modules/tesseract.js-core/tesseract-core-lstm.wasm',
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: buildSecurityHeaders(),
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
