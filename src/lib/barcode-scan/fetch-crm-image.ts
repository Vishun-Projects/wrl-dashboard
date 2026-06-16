import https from 'https';
import http from 'http';

/** Fetch CRM upload image bytes (corporate TLS may fail default Node verification). */
export function fetchCrmImageBuffer(url: string, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      rejectUnauthorized: false,
    };

    const req = lib.request(options, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`Image fetch HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);

    const onAbort = () => {
      req.destroy(new Error('aborted'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });

    req.end();
  });
}
