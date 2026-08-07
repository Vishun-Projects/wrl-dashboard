import { config } from 'dotenv';
import { join } from 'path';

// Load local environment files
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

// Bootstrap MIS email environments
import '@/modules/mis-email/services/bootstrap-env';

import { isVpsCronPaused } from '@/lib/vps-cron/settings';
import { loadDigestRecipients } from '@/modules/mis-email/services/recipients';
import { listMisEmailRoutingRules } from '@/modules/mis-email/services/routing-rules';
import { shouldSendMisEmailNow, resolveMisEmailSendTimeIst, resolveEffectiveDigestIncludes } from '@/modules/mis-email/services/preferences';
import { resolveDigestAttachmentFilenames } from '@/modules/mis-email/services/build-attachments';

async function main() {
  console.log('=== MIS EMAIL DIGEST STATUS DIAGNOSIS ===\n');

  // 1. Cron gates
  const digestPaused = await isVpsCronPaused('mis_email_digest');
  const testPaused = await isVpsCronPaused('mis_email_test');

  console.log('--- VPS Cron Gate Status ---');
  console.log(`mis_email_digest: ${digestPaused ? 'PAUSED ❌' : 'ACTIVE (RUNNING) ✅'}`);
  console.log(`mis_email_test:   ${testPaused ? 'PAUSED ❌' : 'ACTIVE (RUNNING) ✅'}`);
  console.log('');

  // 2. Personal digests
  console.log('--- Personal Digest Recipients (app_users) ---');
  const recipients = await loadDigestRecipients();
  if (recipients.length === 0) {
    console.log('No active personal digest recipients found.');
  } else {
    for (const r of recipients) {
      const sendTime = resolveMisEmailSendTimeIst(r.mis_email_preferences);
      const isSubscribed = r.mis_email_preferences.subscribed !== false;
      const scheduledAt930 = sendTime === '09:30';
      const effective = resolveEffectiveDigestIncludes(r, r.mis_email_preferences);
      const files = resolveDigestAttachmentFilenames(effective);

      console.log(`👤 Name: ${r.name}`);
      console.log(`   Email: ${r.email}`);
      console.log(`   Raw Preferences: ${JSON.stringify(r.mis_email_preferences)}`);
      console.log(`   Effective Includes: ${JSON.stringify(effective)}`);
      console.log(`   Preferences Send Time (IST): ${sendTime} ${scheduledAt930 ? '(Target 09:30 AM Match ✅)' : '(Other Schedule)'}`);
      console.log(`   Subscribed: ${isSubscribed ? 'Yes ✅' : 'No ❌'}`);
      console.log(`   Permissions: Summary=${r.includeSummary}, Detailed=${r.includeDetailed}, KeyAccount=${r.includeKeyAccount}`);
      console.log(`   Effective Attachments to send: ${files.length ? files.join(', ') : 'None'}`);
      console.log('');
    }
  }

  // 3. Routing Rules
  console.log('--- Routing Rule Schedules ---');
  const rules = await listMisEmailRoutingRules();
  const activeRules = rules.filter(rule => rule.autoSendEnabled);
  if (activeRules.length === 0) {
    console.log('No active routing rules found.');
  } else {
    for (const rule of activeRules) {
      const scheduledAt930 = rule.scheduleAnchorTimeIst === '09:30';
      // Routing rule uses buildRoutingComposerRecipient, which always sets:
      // includeOpenCallsExport: true
      const attachmentMode = {
        includeSummary: false,
        includeDetailed: false,
        includeKeyAccount: false,
        includeTraceableExport: false,
        includeOpenCallsExport: true
      };
      const files = resolveDigestAttachmentFilenames(attachmentMode);

      console.log(`📌 Rule ID: ${rule.id}`);
      console.log(`   Filter Scope: Zone="${rule.zone || '*'}" | Branch="${rule.branch || '*'}" | Client="${rule.client || '*'}"`);
      console.log(`   Schedule Anchor (IST): ${rule.scheduleAnchorTimeIst} ${scheduledAt930 ? '(Target 09:30 AM Match ✅)' : '(Other Schedule)'}`);
      console.log(`   Interval: Every ${rule.scheduleIntervalMinutes} minutes`);
      console.log(`   Days of Week: ${rule.scheduleDaysOfWeek.join(', ')}`);
      console.log(`   To Recipients: ${rule.toEmails.join(', ')}`);
      console.log(`   Cc Recipients: ${rule.ccEmails.length ? rule.ccEmails.join(', ') : 'None'}`);
      console.log(`   Attachments to send: ${files.join(', ')}`);
      console.log('');
    }
  }
}

main().catch(err => {
  console.error('Error running diagnosis script:', err);
  process.exitCode = 1;
});
