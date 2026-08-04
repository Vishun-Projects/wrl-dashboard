import { spawn } from 'node:child_process';
import type { MisEmailPreferences } from '@/modules/mis-email/services/preferences';
import type { MisEmailSendResult } from '@/modules/mis-email/services/compose-digest';

export function isVpsSshSendConfigured(): boolean {
  return Boolean(process.env.VPS_SSH_HOST?.trim() || process.env.VPS_HOST?.trim());
}

function resolveVpsSshHost(): string {
  const host = process.env.VPS_SSH_HOST?.trim() || process.env.VPS_HOST?.trim();
  if (!host) {
    throw new Error('VPS SSH host not configured — set VPS_SSH_HOST in .env.local');
  }
  return host;
}

function runSshScript(host: string, script: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', host, 'bash', '-s'],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || `ssh exited with code ${code ?? 'unknown'}`));
    });

    child.stdin.write(script);
    child.stdin.end();
  });
}

/** Run send on VPS over SSH (Postfix on 127.0.0.1) — for local dev when HTTPS relay is blocked. */
export async function sendMisEmailViaVpsSsh(params: {
  userId: string;
  preferences?: MisEmailPreferences;
  sendTo?: string[];
}): Promise<MisEmailSendResult[]> {
  const host = resolveVpsSshHost();
  const installRoot = process.env.VPS_APP_ROOT?.trim() || '/opt/fast-close-app';
  const payload = Buffer.from(JSON.stringify(params), 'utf8').toString('base64');

  const script = [
    `cd '${installRoot}'`,
    `export MIS_EMAIL_SEND_PAYLOAD='${payload}'`,
    'export NODE_ENV=production',
    'npx tsx src/modules/mis-email/services/cli.ts send-user',
  ].join('\n');

  const { stdout, stderr } = await runSshScript(host, script);

  if (stderr?.trim()) {
    console.warn('[mis-email/ssh]', stderr.trim());
  }

  const line = stdout
    .trim()
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean)
    .find((row) => row.startsWith('{') || row.startsWith('['));

  if (!line) {
    throw new Error('VPS send returned no result — sync latest code to /opt/fast-close-app');
  }

  const parsed = JSON.parse(line) as MisEmailSendResult[] | { error?: string };
  if (!Array.isArray(parsed)) {
    throw new Error(parsed.error || 'VPS send failed');
  }
  return parsed;
}
