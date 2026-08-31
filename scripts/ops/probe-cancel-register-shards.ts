import '@/lib/read-model/bootstrap-env';
import { buildCancelledRegisterShardSql } from '@/lib/read-model/cancelled-call-register/crm-fetch';
import { postQuery } from '@/lib/db/proxy';

async function main() {
  for (const [lo, hi] of [
    [1, 100],
    [1001, 1100],
    [5001, 5100],
    [1, 5000],
  ]) {
    const t0 = Date.now();
    try {
      const r = await postQuery({
        rawSql: buildCancelledRegisterShardSql(lo, hi),
        timeoutMs: 120_000,
      });
      console.log(lo, hi, 'OK', Date.now() - t0, (r.data || []).length);
    } catch {
      console.log(lo, hi, 'FAIL', Date.now() - t0);
    }
  }
}

main();
