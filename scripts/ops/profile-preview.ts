import { config } from 'dotenv';
import { join } from 'path';

// Load local environments
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

// Bootstrap MIS email environments
import '../../src/modules/mis-email/services/bootstrap-env';

import { loadDigestRecipients } from '../../src/modules/mis-email/services/recipients';
import { previewMisEmailCompose } from '../../src/modules/mis-email/services/compose-digest';

async function main() {
  const recipients = await loadDigestRecipients();
  if (recipients.length === 0) {
    console.error('No recipients found');
    return;
  }
  const r = recipients[0];
  console.log(`Running preview test for user: ${r.name} (${r.email})`);
  console.log(`Preferences: ${JSON.stringify(r.mis_email_preferences)}`);

  const started = Date.now();
  const preview = await previewMisEmailCompose(r, {
    preferences: {
      ...r.mis_email_preferences,
      bodyInEmail: ['regional_performance', 'branch_performance'],
    }
  });
  console.log(`Finished preview in ${Date.now() - started}ms`);
  console.log(`Subject: ${preview.subject}`);
  console.log(`Attachments: ${preview.attachments.join(', ') || 'None'}`);
}

main().catch(console.error);
