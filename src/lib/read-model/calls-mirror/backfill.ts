import { withClient } from '@/lib/read-model/db';
import { forEachCrmBackfillChunk } from '@/lib/read-model/crm-fetch';
import { todayLocalDate } from '@/lib/read-model/dates';
import { formatLocalDate } from '@/lib/dates/local-date';
import { postQuery } from '@/lib/db/proxy';
import { processCrmRowsForYtdLoad } from '@/lib/read-model/transform';
import { upsertMirrorRows } from '@/lib/read-model/calls-mirror/upsert';
import {
  CALLS_MIRROR_ENTITY,
  CALLS_MIRROR_LOCK_KEY,
} from '@/lib/read-model/calls-mirror/constants';
import {
  finishMirrorBackfill,
  getMirrorSyncState,
  markMirrorError,
  releaseMirrorLock,
  releaseStaleMirrorLock,
  tryAcquireMirrorLock,
  writeMirrorBackfillCursor,
} from '@/lib/read-model/calls-mirror/lock';

const DEFAULT_UPSERT_BATCH = Math.max(
  50,
  Number(process.env.SYNC_HOT_UPSERT_BATCH ?? 300) || 300
);

const FALLBACK_START = '2015-01-01';

function dayAfter(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return formatLocalDate(d);
}

function isEpochOrNull(d: Date | null | undefined): boolean {
  if (!d) return true;
  return d.getTime() < new Date('2000-01-01T00:00:00.000Z').getTime();
}

async function unlockMirrorAdvisory(client: import('pg').PoolClient): Promise<void> {
  await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [CALLS_MIRROR_LOCK_KEY]);
}

async function probeEarliestCrmCallDate(): Promise<string | null> {
  try {
    const res = await postQuery({
      rawSql: `
        SELECT TOP 1 CONVERT(varchar(10), dtrndate, 23) AS d
        FROM trhcalls (NOLOCK)
        WHERE ISNULL(vtrnno, '') <> ''
          AND ISNULL(vtransfercallno, '') = ''
          AND ISNULL(CAST(ncancelreason AS INT), 0) <> 2
          AND dtrndate IS NOT NULL
        ORDER BY dtrndate ASC
      `,
    });
    const d = String((res.data?.[0] as { d?: string } | undefined)?.d ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  } catch (err) {
    console.warn(
      '[calls-mirror] CRM min-date probe failed:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function resolveMirrorBackfillStart(): Promise<string> {
  const envStart = process.env.CALLS_MIRROR_START_DATE?.trim();
  if (envStart && /^\d{4}-\d{2}-\d{2}$/.test(envStart)) return envStart;
  const probed = await probeEarliestCrmCallDate();
  return probed ?? FALLBACK_START;
}

export type CallsMirrorBackfillResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  startDate?: string;
  endDate?: string;
  totalFetched?: number;
  totalUpserted?: number;
  complete?: boolean;
};

/**
 * Stream CRM by dtrndate into calls_crm_mirror. Resumes from sync_state.last_addedon
 * (last completed calendar day). Marks status=ok when filling through today (no END override).
 */
export async function runCallsMirrorBackfill(): Promise<CallsMirrorBackfillResult> {
  if (process.env.SYNC_WORKER_ENABLED !== 'true') {
    return { ok: false, skipped: true, reason: 'SYNC_WORKER_ENABLED is not true' };
  }

  const endOverride = process.env.CALLS_MIRROR_END_DATE?.trim();
  const endDate =
    endOverride && /^\d{4}-\d{2}-\d{2}$/.test(endOverride) ? endOverride : todayLocalDate();
  const configuredStart = await resolveMirrorBackfillStart();

  return withClient(async (client) => {
    await releaseStaleMirrorLock(client);
    const acquired = await tryAcquireMirrorLock(client);
    if (!acquired) {
      return { ok: false, skipped: true, reason: 'mirror lock not acquired' };
    }

    try {
      const state = await getMirrorSyncState(client);
      if (state?.status === 'ok' && process.env.CALLS_MIRROR_FORCE_BACKFILL !== 'true') {
        await releaseMirrorLock(client, 'ok', 0);
        return {
          ok: true,
          skipped: true,
          reason: 'already ok — set CALLS_MIRROR_FORCE_BACKFILL=true to re-run',
        };
      }

      let startDate = configuredStart;
      if (
        (state?.status === 'backfilling' || state?.status === 'error') &&
        state.last_addedon &&
        !isEpochOrNull(state.last_addedon)
      ) {
        const cursorDay = formatLocalDate(state.last_addedon);
        startDate = dayAfter(cursorDay);
      }

      if (startDate > endDate) {
        if (!endOverride) {
          const fresh = await getMirrorSyncState(client);
          const stamp = await finishMirrorBackfill(client, {
            watermarkFrom: !isEpochOrNull(fresh?.last_editedon) ? fresh!.last_editedon : null,
          });
          await unlockMirrorAdvisory(client);
          return {
            ok: true,
            skipped: true,
            reason: `cursor past end; watermark ${stamp?.toISOString() ?? 'n/a'}`,
            startDate,
            endDate,
            complete: true,
          };
        }
        await releaseMirrorLock(client, 'backfilling', 0);
        return {
          ok: true,
          skipped: true,
          reason: `cursor past CALLS_MIRROR_END_DATE (${startDate} > ${endDate})`,
          startDate,
          endDate,
          complete: false,
        };
      }

      // Remember wall-clock start so editedon incremental covers edits during this long backfill.
      const envWm = process.env.CALLS_MIRROR_WATERMARK_FROM?.trim();
      const jobStartedAt = envWm
        ? new Date(envWm)
        : new Date(Date.now() - 60 * 60 * 1000); // 1h overlap
      if (Number.isNaN(jobStartedAt.getTime())) {
        throw new Error(`Invalid CALLS_MIRROR_WATERMARK_FROM=${envWm}`);
      }
      if (isEpochOrNull(state?.last_editedon) || state?.status === 'pending_backfill') {
        await client.query(
          `UPDATE sync_state SET status = 'backfilling', last_editedon = $2 WHERE entity = $1`,
          [CALLS_MIRROR_ENTITY, jobStartedAt]
        );
        console.log(
          `[calls-mirror] Incremental catch-up watermark set to ${jobStartedAt.toISOString()} (edits after this are re-synced when backfill finishes)`
        );
      } else {
        await client.query(`UPDATE sync_state SET status = 'backfilling' WHERE entity = $1`, [
          CALLS_MIRROR_ENTITY,
        ]);
        console.log(
          `[calls-mirror] Keeping catch-up watermark ${state!.last_editedon!.toISOString()}`
        );
      }

      console.log(
        `[calls-mirror] Backfill ${startDate} .. ${endDate} (entity=${CALLS_MIRROR_ENTITY})`
      );

      const batchSize = DEFAULT_UPSERT_BATCH;
      let totalUpserted = 0;

      const totalFetched = await forEachCrmBackfillChunk(
        startDate,
        endDate,
        async ({ chunk, rows }) => {
          const hotRows = processCrmRowsForYtdLoad(rows);
          const upserted = await upsertMirrorRows(client, hotRows, batchSize);
          totalUpserted += upserted;
          const chunkEnd = chunk.includes('..') ? chunk.split('..')[1]! : chunk;
          await writeMirrorBackfillCursor(client, chunkEnd, upserted);
          console.log(
            `[calls-mirror] Backfill chunk ${chunk} — crm=${rows.length}, upserted=${upserted}`
          );
        }
      );

      const fullHistoryDone = !endOverride && endDate >= todayLocalDate();
      if (fullHistoryDone) {
        const fresh = await getMirrorSyncState(client);
        const stamp = await finishMirrorBackfill(client, {
          watermarkFrom: !isEpochOrNull(fresh?.last_editedon) ? fresh!.last_editedon : jobStartedAt,
        });
        await unlockMirrorAdvisory(client);
        console.log(
          `[calls-mirror] Backfill complete — fetched ${totalFetched}, upserted ${totalUpserted}, editedon watermark ${stamp?.toISOString() ?? 'n/a'} (catch-up from backfill start)`
        );
        return {
          ok: true,
          startDate: configuredStart,
          endDate,
          totalFetched,
          totalUpserted,
          complete: true,
        };
      }

      await releaseMirrorLock(client, 'backfilling', totalUpserted);
      console.log(
        `[calls-mirror] Backfill window done — fetched ${totalFetched}, upserted ${totalUpserted}, status=backfilling`
      );
      return {
        ok: true,
        startDate,
        endDate,
        totalFetched,
        totalUpserted,
        complete: false,
        reason: endOverride
          ? 'CALLS_MIRROR_END_DATE set — left status=backfilling'
          : undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markMirrorError(client, message);
      throw err;
    }
  });
}
