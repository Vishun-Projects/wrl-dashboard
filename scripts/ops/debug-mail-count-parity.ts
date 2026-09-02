import '@/modules/mis-email/services/bootstrap-env';
import { previewMisEmailCompose } from '@/modules/mis-email/services/compose-digest';
import { loadDigestRecipients } from '@/modules/mis-email/services/recipients';
import { fetchDigestSummaryDataCached, fetchDigestClientAccountSummaryCached } from '@/modules/mis-email/services/digest-cache';
import { resolveDigestDateRangeForPreferences } from '@/modules/mis-email/services/preferences';
import { resolveUserDigestScopeWithLabel } from '@/modules/mis-email/services/user-scope';
import { computeMisSourceBreakdown } from '@/modules/mis/services/mis-unified-metrics';
import { closePool } from '@/lib/read-model/db';

async function main(): Promise<void> {
  try {
    const recipients = await loadDigestRecipients();
    if (!recipients.length) {
      console.log('No recipients');
      return;
    }
    const r = recipients[0];
    const dateRange = resolveDigestDateRangeForPreferences(r.mis_email_preferences);
    const scope = await resolveUserDigestScopeWithLabel(r);
    const [summary, clientAccounts] = await Promise.all([
      fetchDigestSummaryDataCached(scope, dateRange),
      fetchDigestClientAccountSummaryCached(dateRange),
    ]);
    const breakdown = computeMisSourceBreakdown(summary, clientAccounts);
    console.log('\n=== MIS UNIFIED SOURCE BREAKDOWN ===');
    console.log('Date range:', dateRange.label);
    console.log('\nCRM (all accounts in Postgres summary):');
    console.log(breakdown.crm);
    console.log('\nMondelez import (Cadbury client file):');
    console.log(breakdown.mondelezImport);
    console.log('\nCoke import (HCCB client file):');
    console.log(breakdown.cokeImport);
    console.log('\nMERGED (same formula as Summary Dashboard + mail body):');
    console.log(breakdown.merged);

    console.log('\nPreviewing mail...');
    await previewMisEmailCompose(r, { displayName: r.name });
  } catch (e) {
    console.error('ERR', e);
  } finally {
    await closePool();
  }
}

main();
