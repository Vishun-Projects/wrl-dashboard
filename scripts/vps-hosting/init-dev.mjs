import readline from 'readline';
import { spawn } from 'child_process';

async function promptPassphrase() {
  if (!process.stdin.isTTY) return '';

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('\n🔑 Enter SSH Key Passphrase for Hostinger VPS (Press Enter to skip): ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const passphrase = await promptPassphrase();

  const env = { ...process.env };

  if (passphrase) {
    env.VPS_SSH_PASSPHRASE = passphrase;
    console.log('✅ VPS SSH Passphrase configured for Next.js dev server!\n');
  } else {
    console.log('⚡ Skipping VPS SSH bridge. Starting local dev server...\n');
  }

  // Start Next.js dev server with process.env.VPS_SSH_PASSPHRASE passed through
  const nextDev = spawn('npx', ['next', 'dev', ...process.argv.slice(2)], {
    stdio: 'inherit',
    shell: true,
    env,
  });

  nextDev.on('exit', (code) => {
    process.exit(code || 0);
  });
}

main();
