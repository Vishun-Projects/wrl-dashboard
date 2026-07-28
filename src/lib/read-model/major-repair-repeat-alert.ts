import { postQuery } from '@/lib/db/proxy';
import { daysAgoDate, todayLocalDate } from '@/lib/read-model/dates';
import { withClient } from '@/lib/read-model/db';
import { createMailTransport, isSmtpConfigured, resolveSmtpConfig } from '@/lib/mail/smtp';
import type { HotRow } from '@/lib/read-model/types';
import {
  listEnabledEmailsForBranch,
  resolveAlertRecipients,
} from '@/lib/read-model/major-repair-repeat-recipients';
import { normalizeSerial } from '@/lib/serial/normalize';
import {
  buildMajorRepairRepeatCountSql,
  buildMajorRepairRepeatDetailSql,
  buildRegisterRepairDoneByCallKeysSql,
} from '@/lib/trhcalls/query';
import {
  assertOrgOutboundMailEnabled,
  getMisEmailOrgSettings,
} from '@/lib/org-settings/mis-email';

const CRM_TIMEOUT_MS = 45_000;
const REPAIR_ENRICH_CHUNK = 150;
const TARGET_REPAIRS = ['Motor Replaced', 'Compressor Replaced', 'Gas Charging Done'] as const;

export const DEFAULT_MAJOR_REPAIR_REPEAT_TO = 'sunil.sawant@westernequipments.com';
export const DEFAULT_MAJOR_REPAIR_REPEAT_CC = 'vishnu.vishwakarma@westernequipments.com';

export function isMajorRepairRepeatAlertEnabled(): boolean {
  return process.env.MAJOR_REPAIR_REPEAT_ALERT_ENABLED !== 'false';
}

export function majorRepairRepeatMinCount(): number {
  const n = Number(process.env.MAJOR_REPAIR_REPEAT_MIN_COUNT ?? 3);
  return Number.isFinite(n) && n >= 2 ? Math.trunc(n) : 3;
}

export function majorRepairRepeatMonths(): number {
  const n = Number(process.env.MAJOR_REPAIR_REPEAT_MONTHS ?? 3);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 3;
}

export function majorRepairRepeatToEmail(): string {
  return process.env.MAJOR_REPAIR_REPEAT_TO?.trim() || DEFAULT_MAJOR_REPAIR_REPEAT_TO;
}

export function majorRepairRepeatCcEmail(): string {
  return process.env.MAJOR_REPAIR_REPEAT_CC?.trim() || DEFAULT_MAJOR_REPAIR_REPEAT_CC;
}

export function majorRepairRepeatDateWindow(
  months = majorRepairRepeatMonths(),
  now = new Date()
): { startDate: string; endDate: string } {
  void now;
  const days = months * 30;
  return {
    startDate: daysAgoDate(days),
    endDate: todayLocalDate(),
  };
}

export function meetsRepeatThreshold(count: number, minCount = majorRepairRepeatMinCount()): boolean {
  return count >= minCount;
}

function flagOn(v: unknown): boolean {
  return v === 1 || v === '1' || v === true;
}

export function repairDoneFromCrmFlags(row: Record<string, unknown>): string {
  const parts: string[] = [];
  if (flagOn(row.has_motor)) parts.push('Motor Replaced');
  if (flagOn(row.has_compressor)) parts.push('Compressor Replaced');
  if (flagOn(row.has_gas)) parts.push('Gas Charging Done');
  return parts.join('; ');
}

export function hasTargetRepair(repairDone: string): boolean {
  const normalized = repairDone.trim().toLowerCase();
  if (!normalized) return false;
  return TARGET_REPAIRS.some((name) => normalized.includes(name.toLowerCase()));
}

export type MajorRepairAlertCandidate = HotRow & { repair_done: string };

/** Major calls with motor/compressor/gas repair on this sync batch. */
export function filterMajorRepairAlertCandidates(
  rows: HotRow[],
  repairDoneByTrn: Map<string, string>
): MajorRepairAlertCandidate[] {
  const out: MajorRepairAlertCandidate[] = [];
  for (const row of rows) {
    if (!row.is_major) continue;
    if (!normalizeSerial(row.serial)) continue;
    const repair_done = repairDoneByTrn.get(row.vtrnno) ?? '';
    if (!hasTargetRepair(repair_done)) continue;
    out.push({ ...row, repair_done });
  }
  return out;
}

async function fetchRepairDoneByTrn(rows: HotRow[]): Promise<Map<string, string>> {
  const byTrn = new Map<string, string>();
  const keys = [
    ...new Map(
      rows
        .map((r) => ({ ncode: r.ncode, officeId: r.nofficeid }))
        .filter((k) => k.ncode > 0 && k.officeId > 0)
        .map((k) => [`${k.ncode}:${k.officeId}`, k] as const)
    ).values(),
  ];
  if (!keys.length) return byTrn;

  const trnByKey = new Map(
    rows.map((r) => [`${r.ncode}:${r.nofficeid}`, r.vtrnno] as const)
  );

  for (let i = 0; i < keys.length; i += REPAIR_ENRICH_CHUNK) {
    const chunk = keys.slice(i, i + REPAIR_ENRICH_CHUNK);
    const rawSql = buildRegisterRepairDoneByCallKeysSql(chunk);
    if (!rawSql) continue;
    const res = await postQuery({ rawSql, timeoutMs: CRM_TIMEOUT_MS });
    for (const row of (res.data || []) as Record<string, unknown>[]) {
      const key = `${Number(row.id)}:${Number(row.office_id)}` as `${number}:${number}`;
      const trn = trnByKey.get(key);
      if (!trn) continue;
      const done = repairDoneFromCrmFlags(row);
      if (done) byTrn.set(trn, done);
    }
  }
  return byTrn;
}

async function fetchAlreadyAlertedTrns(trns: string[]): Promise<Set<string>> {
  if (!trns.length) return new Set();
  return withClient(async (client) => {
    const res = await client.query<{ vtrnno: string }>(
      'SELECT vtrnno FROM major_repair_repeat_alert_sent WHERE vtrnno = ANY($1::varchar[])',
      [trns]
    );
    return new Set(res.rows.map((r) => r.vtrnno));
  });
}

async function recordAlertSent(vtrnno: string, serial: string, callCount: number): Promise<void> {
  await withClient((client) =>
    client.query(
      `INSERT INTO major_repair_repeat_alert_sent (vtrnno, serial, call_count)
       VALUES ($1, $2, $3)
       ON CONFLICT (vtrnno) DO NOTHING`,
      [vtrnno, serial, callCount]
    )
  );
}

async function fetchRepeatCount(
  serial: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const rawSql = buildMajorRepairRepeatCountSql(serial, startDate, endDate);
  const res = await postQuery({ rawSql, timeoutMs: CRM_TIMEOUT_MS });
  const row = (res.data?.[0] ?? {}) as Record<string, unknown>;
  return Number(row.call_count) || 0;
}

type RepeatDetailRow = {
  vtrnno: string;
  callsdtrndate: string;
  PartyName: string;
  repair_done: string;
  vcomplaint: string;
  callstatus: string;
};

async function fetchRepeatDetails(
  serial: string,
  startDate: string,
  endDate: string
): Promise<RepeatDetailRow[]> {
  const rawSql = buildMajorRepairRepeatDetailSql(serial, startDate, endDate);
  const res = await postQuery({ rawSql, timeoutMs: CRM_TIMEOUT_MS });
  return ((res.data || []) as Record<string, unknown>[]).map((row) => ({
    vtrnno: String(row.vtrnno ?? row.UniqueCallNo ?? '').trim(),
    callsdtrndate: String(row.callsdtrndate ?? '').trim(),
    PartyName: String(row.PartyName ?? '').trim(),
    repair_done: String(row.repair_done ?? '').trim(),
    vcomplaint: String(row.vcomplaint ?? '').trim(),
    callstatus: String(row.callstatus ?? row.Status ?? '').trim(),
  }));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildAlertEmailHtml(params: {
  serial: string;
  triggerTrn: string;
  branchName: string;
  callCount: number;
  months: number;
  startDate: string;
  endDate: string;
  details: RepeatDetailRow[];
}): string {
  const branch = params.branchName.trim() || 'Unknown';
  const rows = params.details
    .map(
      (d) => `<tr>
        <td style="padding:6px 8px;border:1px solid #ddd;">${escapeHtml(d.vtrnno)}</td>
        <td style="padding:6px 8px;border:1px solid #ddd;">${escapeHtml(d.callsdtrndate)}</td>
        <td style="padding:6px 8px;border:1px solid #ddd;">${escapeHtml(d.PartyName)}</td>
        <td style="padding:6px 8px;border:1px solid #ddd;">${escapeHtml(d.repair_done)}</td>
        <td style="padding:6px 8px;border:1px solid #ddd;">${escapeHtml(d.callstatus)}</td>
        <td style="padding:6px 8px;border:1px solid #ddd;">${escapeHtml(d.vcomplaint.slice(0, 120))}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.45;">
    <p style="margin:0 0 12px 0;"><strong>WRL SLA notification — major repair repeat</strong></p>
    <p style="margin:0 0 8px 0;">A new major call with Motor Replaced / Compressor Replaced / Gas Charging Done has pushed this serial over the repeat threshold.</p>
    <table style="border-collapse:collapse;margin:0 0 16px 0;">
      <tr><td style="padding:4px 12px 4px 0;color:#555;">Triggering open call ID</td><td style="padding:4px 0;"><strong>${escapeHtml(params.triggerTrn)}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555;">Serial number</td><td style="padding:4px 0;"><strong>${escapeHtml(params.serial)}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555;">Branch</td><td style="padding:4px 0;">${escapeHtml(branch)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#555;">Repeat count</td><td style="padding:4px 0;">${params.callCount} call(s) in the last ${params.months} months (${escapeHtml(params.startDate)} to ${escapeHtml(params.endDate)})</td></tr>
    </table>
    <p style="margin:0 0 8px 0;"><strong>History on this serial</strong> (major calls with Motor / Compressor / Gas in the window):</p>
    <table style="border-collapse:collapse;width:100%;max-width:960px;">
      <thead><tr style="background:#f4f4f4;">
        <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Call ID</th>
        <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Logged</th>
        <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Party</th>
        <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Repairs</th>
        <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Status</th>
        <th style="padding:6px 8px;border:1px solid #ddd;text-align:left;">Complaint</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="6" style="padding:6px 8px;border:1px solid #ddd;">No detail rows returned.</td></tr>`}</tbody>
    </table>
  </body></html>`;
}

export function buildAlertEmailText(params: {
  serial: string;
  triggerTrn: string;
  branchName: string;
  callCount: number;
  months: number;
  startDate: string;
  endDate: string;
}): string {
  const branch = params.branchName.trim() || 'Unknown';
  return [
    'WRL SLA notification — major repair repeat',
    '',
    `Triggering open call ID: ${params.triggerTrn}`,
    `Serial number: ${params.serial}`,
    `Branch: ${branch}`,
    `Repeat count: ${params.callCount} call(s) in the last ${params.months} months (${params.startDate} to ${params.endDate})`,
    '',
    'This email is an SLA alert only (Motor / Compressor / Gas repeat on the same serial).',
  ].join('\n');
}

async function sendRepeatAlertEmail(params: {
  serial: string;
  triggerTrn: string;
  branchName: string;
  callCount: number;
  months: number;
  startDate: string;
  endDate: string;
  details: RepeatDetailRow[];
}): Promise<void> {
  if (!isSmtpConfigured()) {
    console.warn(
      '[sync-worker] major-repair-repeat-alert: SMTP not configured — skip send (set SMTP in .env.mis-email)'
    );
    return;
  }

  const org = await getMisEmailOrgSettings();
  const branchPeople = await listEnabledEmailsForBranch(params.branchName);
  const { to, cc } = resolveAlertRecipients({
    branchEmails: branchPeople.map((p) => p.email),
    hqTo: process.env.MAJOR_REPAIR_REPEAT_TO?.trim() || org.majorRepairDefaultTo,
    hqCc: process.env.MAJOR_REPAIR_REPEAT_CC?.trim() || org.majorRepairDefaultCc,
  });
  if (!to.length) {
    throw new Error(
      `no recipients for branch "${params.branchName || '(empty)'}" and HQ To/Cc empty`
    );
  }

  const smtp = resolveSmtpConfig();
  const transport = createMailTransport(smtp);
  const subject = `WRL SLA Alert: Major repair repeat — Call ${params.triggerTrn} — Serial ${params.serial}`;
  const html = buildAlertEmailHtml(params);
  const text = buildAlertEmailText(params);
  const info = await transport.sendMail({
    from: smtp.from,
    to: to.join(', '),
    ...(cc.length ? { cc: cc.join(', ') } : {}),
    subject,
    html,
    text,
  });
  const branchLabel = branchPeople.length
    ? branchPeople.map((p) => `${p.name}<${p.email}>`).join('; ')
    : '(HQ fallback)';
  console.log(
    `[sync-worker] major-repair-repeat-alert: sent email for ${params.triggerTrn} (serial ${params.serial}, branch ${params.branchName}, count ${params.callCount}) to=${to.join(',')} cc=${cc.join(',') || '-'} branchRecipients=${branchLabel} messageId=${info.messageId}`
  );
}

/** Post-sync hook: email when a newly synced major+repair call exceeds repeat threshold. */
export async function checkMajorRepairRepeatAlerts(upsertedRows: HotRow[]): Promise<void> {
  if (!isMajorRepairRepeatAlertEnabled()) return;
  if (!upsertedRows.length) return;

  try {
    await assertOrgOutboundMailEnabled();
  } catch {
    return;
  }

  const org = await getMisEmailOrgSettings();
  const majorRows = upsertedRows.filter((r) => r.is_major && normalizeSerial(r.serial));
  if (!majorRows.length) return;

  const repairDoneByTrn = await fetchRepairDoneByTrn(majorRows);
  const candidates = filterMajorRepairAlertCandidates(majorRows, repairDoneByTrn);
  if (!candidates.length) return;

  const alreadySent = await fetchAlreadyAlertedTrns(candidates.map((c) => c.vtrnno));
  const pending = candidates.filter((c) => !alreadySent.has(c.vtrnno));
  if (!pending.length) return;

  const minCount = process.env.MAJOR_REPAIR_REPEAT_MIN_COUNT
    ? majorRepairRepeatMinCount()
    : org.majorRepairMinCount;
  const months = process.env.MAJOR_REPAIR_REPEAT_MONTHS
    ? majorRepairRepeatMonths()
    : org.majorRepairMonths;
  const { startDate, endDate } = majorRepairRepeatDateWindow(months);

  const bySerial = new Map<string, MajorRepairAlertCandidate[]>();
  for (const row of pending) {
    const serial = normalizeSerial(row.serial);
    if (!serial) continue;
    const list = bySerial.get(serial) ?? [];
    list.push(row);
    bySerial.set(serial, list);
  }

  for (const [serial, rowsForSerial] of bySerial) {
    const trigger = rowsForSerial[0];
    if (!trigger) continue;

    let callCount: number;
    try {
      callCount = await fetchRepeatCount(serial, startDate, endDate);
    } catch (err) {
      console.warn(
        `[sync-worker] major-repair-repeat-alert: CRM count failed for ${serial}:`,
        err instanceof Error ? err.message : err
      );
      continue;
    }

    if (!meetsRepeatThreshold(callCount, minCount)) {
      console.log(
        `[sync-worker] major-repair-repeat-alert: skip ${trigger.vtrnno} — serial ${serial} has ${callCount} call(s) (< ${minCount})`
      );
      continue;
    }

    let details: RepeatDetailRow[];
    try {
      details = await fetchRepeatDetails(serial, startDate, endDate);
    } catch (err) {
      console.warn(
        `[sync-worker] major-repair-repeat-alert: CRM detail failed for ${serial}:`,
        err instanceof Error ? err.message : err
      );
      continue;
    }

    try {
      await sendRepeatAlertEmail({
        serial,
        triggerTrn: trigger.vtrnno,
        branchName: trigger.branch_name ?? '',
        callCount,
        months,
        startDate,
        endDate,
        details,
      });
      for (const row of rowsForSerial) {
        await recordAlertSent(row.vtrnno, serial, callCount);
      }
    } catch (err) {
      console.warn(
        `[sync-worker] major-repair-repeat-alert: send/record failed for ${trigger.vtrnno}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}
