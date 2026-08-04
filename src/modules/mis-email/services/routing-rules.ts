import { seesAllOfficesForUser } from '@/lib/auth/rbac-catalog';
import { assertAllowedEmailDomains } from '@/modules/mis-email/services/allowed-domains';
import { getMisEmailOrgSettings } from '@/modules/mis-email/services/org-settings';
import { resolveDigestDateRangeForPreferences } from '@/modules/mis-email/services/preferences';
import {
  queryDigestAccountNames,
  queryCrmDigestAccountNames,
} from '@/modules/mis-email/services/query-digest-account-names';
import { withAppClient } from '@/lib/read-model/db';
import { queryRegisterFilterOptionsFromPostgres } from '@/sql/read-model/register';
import { joinFilterParam } from '@/modules/mis';

export type MisEmailRoutingClientSourceMode = 'mail' | 'crm';

export type MisEmailRoutingRule = {
  id: string;
  zone: string;
  branch: string;
  client: string;
  clientSourceMode: MisEmailRoutingClientSourceMode;
  scheduleAnchorTimeIst: string;
  scheduleIntervalMinutes: number;
  scheduleDaysOfWeek: string[];
  scheduleWindowStartIst: string | null;
  scheduleWindowEndIst: string | null;
  toEmails: string[];
  ccEmails: string[];
  autoSendEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MisEmailRoutingOptions = {
  zones: string[];
  branches: string[];
  clients: string[];
};

type RuleRow = {
  id: string;
  zone: string | null;
  branch: string | null;
  client: string | null;
  client_source_mode: string | null;
  schedule_anchor_time_ist: string | null;
  schedule_interval_minutes: number | null;
  schedule_days_of_week: string[] | null;
  schedule_window_start_ist: string | null;
  schedule_window_end_ist: string | null;
  to_emails: string[] | null;
  cc_emails: string[] | null;
  auto_send_enabled: boolean | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type UserScopeForRouting = {
  role: string;
  office_ids: string[];
  permissions: string[];
};

let ensured = false;
const TIME_HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const DAY_TO_INDEX: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeKey(value: string): string {
  return normalizeText(value).replace(/\s+ZONE$/i, '').toUpperCase();
}

function splitDimensionKeys(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((token) => normalizeKey(token))
        .filter(Boolean)
    )
  );
}

function normalizeEmailToken(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeTimeOrThrow(raw: string | null | undefined, fieldLabel: string): string {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error(`${fieldLabel} is required`);
  if (!TIME_HH_MM_RE.test(value)) throw new Error(`${fieldLabel} must be HH:mm`);
  return value;
}

function normalizeOptionalTime(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (!TIME_HH_MM_RE.test(value)) throw new Error('Window times must be HH:mm');
  return value;
}

function normalizeScheduleDays(days: string[] | null | undefined): string[] {
  const incoming = Array.isArray(days) ? days : [];
  const normalized = Array.from(
    new Set(
      incoming
        .map((day) => String(day ?? '').trim().toUpperCase())
        .filter((day) => day in DAY_TO_INDEX)
    )
  );
  return normalized.length > 0 ? normalized : [...DEFAULT_DAYS];
}

function clampIntervalMinutes(raw: number | null | undefined): number {
  const parsed = Number(raw ?? 1440);
  if (!Number.isFinite(parsed)) return 1440;
  return Math.max(5, Math.min(1440, Math.floor(parsed)));
}

export function normalizeMisEmailRoutingClientSourceMode(
  raw: string | null | undefined
): MisEmailRoutingClientSourceMode {
  return String(raw ?? '').trim().toLowerCase() === 'crm' ? 'crm' : 'mail';
}

export function parseCommaEmails(raw: string): string[] {
  if (!raw.trim()) return [];
  const dedupe = new Set<string>();
  for (const token of raw.split(',')) {
    const email = normalizeEmailToken(token);
    if (!email) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`Invalid email: ${token.trim() || '(empty)'}`);
    }
    dedupe.add(email);
  }
  return [...dedupe];
}

export function formatEmailsCsv(emails: string[]): string {
  return emails.join(', ');
}

export function canManageMisEmailRouting(user: UserScopeForRouting): boolean {
  if (user.permissions.includes('manage_users') || user.permissions.includes('manage_roles')) {
    return true;
  }
  return seesAllOfficesForUser(user.permissions, user.role, user.office_ids ?? []);
}

function rowToRule(row: RuleRow): MisEmailRoutingRule {
  return {
    id: row.id,
    zone: normalizeText(String(row.zone ?? '')),
    branch: normalizeText(String(row.branch ?? '')),
    client: normalizeText(String(row.client ?? '')),
    clientSourceMode: normalizeMisEmailRoutingClientSourceMode(row.client_source_mode),
    scheduleAnchorTimeIst: normalizeTimeOrThrow(
      row.schedule_anchor_time_ist ?? '07:00',
      'Schedule anchor time'
    ),
    scheduleIntervalMinutes: clampIntervalMinutes(row.schedule_interval_minutes),
    scheduleDaysOfWeek: normalizeScheduleDays(row.schedule_days_of_week),
    scheduleWindowStartIst: normalizeOptionalTime(row.schedule_window_start_ist),
    scheduleWindowEndIst: normalizeOptionalTime(row.schedule_window_end_ist),
    toEmails: (row.to_emails ?? []).map(String),
    ccEmails: (row.cc_emails ?? []).map(String),
    autoSendEnabled: row.auto_send_enabled === true,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function ensureMisEmailRoutingRulesTable(): Promise<void> {
  if (ensured) return;
  await withAppClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.mis_email_routing_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        zone text NOT NULL DEFAULT '',
        branch text NOT NULL DEFAULT '',
        client text NOT NULL DEFAULT '',
        client_source_mode text NOT NULL DEFAULT 'mail',
        schedule_anchor_time_ist text NOT NULL DEFAULT '07:00',
        schedule_interval_minutes integer NOT NULL DEFAULT 1440,
        schedule_days_of_week text[] NOT NULL DEFAULT ARRAY['MON','TUE','WED','THU','FRI','SAT','SUN']::text[],
        schedule_window_start_ist text NULL,
        schedule_window_end_ist text NULL,
        to_emails text[] NOT NULL DEFAULT '{}',
        cc_emails text[] NOT NULL DEFAULT '{}',
        auto_send_enabled boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mis_email_routing_rules_zone_branch_client
      ON public.mis_email_routing_rules (upper(btrim(zone)), upper(btrim(branch)), upper(btrim(client)));
    `);
    await client.query(`
      ALTER TABLE public.mis_email_routing_rules
        ADD COLUMN IF NOT EXISTS client_source_mode text NOT NULL DEFAULT 'mail',
        ADD COLUMN IF NOT EXISTS schedule_anchor_time_ist text NOT NULL DEFAULT '07:00',
        ADD COLUMN IF NOT EXISTS schedule_interval_minutes integer NOT NULL DEFAULT 1440,
        ADD COLUMN IF NOT EXISTS schedule_days_of_week text[] NOT NULL DEFAULT ARRAY['MON','TUE','WED','THU','FRI','SAT','SUN']::text[],
        ADD COLUMN IF NOT EXISTS schedule_window_start_ist text,
        ADD COLUMN IF NOT EXISTS schedule_window_end_ist text;
    `);
    await client.query(`
      ALTER TABLE public.mis_email_routing_rules
        ALTER COLUMN auto_send_enabled SET DEFAULT false;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.mis_email_routing_send_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        rule_id uuid NOT NULL,
        recipient_id uuid NOT NULL,
        recipient_email text NOT NULL,
        sent_to text NOT NULL,
        status text NOT NULL,
        error text,
        triggered_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mis_email_routing_send_log_rule_time
      ON public.mis_email_routing_send_log (rule_id, triggered_at DESC);
    `);
  });
  ensured = true;
}

export async function listMisEmailRoutingRules(): Promise<MisEmailRoutingRule[]> {
  await ensureMisEmailRoutingRulesTable();
  return withAppClient(async (client) => {
    const res = await client.query<RuleRow>(
      `SELECT id, zone, branch, client, client_source_mode, schedule_anchor_time_ist, schedule_interval_minutes, schedule_days_of_week,
              schedule_window_start_ist, schedule_window_end_ist, to_emails, cc_emails, auto_send_enabled, created_at, updated_at
       FROM public.mis_email_routing_rules
       ORDER BY upper(zone), upper(branch), upper(client), created_at ASC`
    );
    return res.rows.map(rowToRule);
  });
}

export async function listMisEmailRoutingOptions(input: {
  zone?: string;
  branch?: string;
  clientSourceMode?: MisEmailRoutingClientSourceMode;
  assignedOffices: string[];
  visibleStatuses: string[];
  isHod: boolean;
}): Promise<MisEmailRoutingOptions> {
  await ensureMisEmailRoutingRulesTable();
  const zone = normalizeText(input.zone ?? '');
  const branch = normalizeText(input.branch ?? '');
  const clientSourceMode = normalizeMisEmailRoutingClientSourceMode(input.clientSourceMode);

  const baseParams = {
    search: '',
    officeId: 'All',
    callType: 'All',
    startDate: '',
    endDate: '',
    status: '',
    account: '',
    region: zone,
    pincode: '',
    priority: 'all',
    portalFilter: 'All',
    state: '',
    city: '',
    branch: '',
    franchisee: '',
    technician: '',
    assignedOffices: input.assignedOffices,
    visibleStatuses: input.visibleStatuses,
    isHod: input.isHod,
  } as const;

  const scoped = await queryRegisterFilterOptionsFromPostgres(baseParams);
  const zones = Array.from(
    new Set(scoped.regionsList.map((row) => normalizeText(String(row.vname ?? ''))).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
  const branches = Array.from(
    new Set(scoped.branchesList.map((row) => normalizeText(String(row.vcompanyname ?? ''))).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  let clients: string[] = [];
  if (clientSourceMode === 'crm') {
    if (!zone || !branch) {
      clients = Array.from(
        new Set(scoped.accountsList.map((row) => normalizeText(String(row.vname ?? ''))).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b));
    } else {
      const matchingBranchIds = scoped.branchesList
        .filter((row) => normalizeKey(String(row.vcompanyname ?? '')) === normalizeKey(branch))
        .map((row) => String(row.ncode))
        .filter(Boolean);

      if (matchingBranchIds.length === 0) {
        return { zones, branches, clients: [] };
      }

      const branchScoped = await queryRegisterFilterOptionsFromPostgres({
        ...baseParams,
        branch: joinFilterParam(matchingBranchIds) ?? '',
      });
      clients = Array.from(
        new Set(branchScoped.accountsList.map((row) => normalizeText(String(row.vname ?? ''))).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b));
    }
  } else {
    const dateRange = resolveDigestDateRangeForPreferences({ dateRange: 'month_to_date' });
    const scope = {
      isHod: input.isHod,
      assignedOffices: input.assignedOffices,
      scopeLabel: input.isHod || input.assignedOffices.length === 0 ? 'All branches' : 'Selected branches',
    };
    clients = await queryDigestAccountNames(scope, dateRange);
  }
  return { zones, branches, clients };
}

export async function createMisEmailRoutingRule(input: {
  zone?: string;
  branch?: string;
  client?: string;
  clientSourceMode?: MisEmailRoutingClientSourceMode;
  scheduleAnchorTimeIst?: string;
  scheduleIntervalMinutes?: number;
  scheduleDaysOfWeek?: string[];
  scheduleWindowStartIst?: string | null;
  scheduleWindowEndIst?: string | null;
  toEmailsCsv: string;
  ccEmailsCsv?: string;
  autoSendEnabled?: boolean;
}): Promise<MisEmailRoutingRule> {
  await ensureMisEmailRoutingRulesTable();
  const zone = normalizeText(input.zone ?? '');
  const branch = normalizeText(input.branch ?? '');
  const clientName = normalizeText(input.client ?? '');
  const clientSourceMode = normalizeMisEmailRoutingClientSourceMode(input.clientSourceMode);
  const scheduleAnchorTimeIst = normalizeTimeOrThrow(
    input.scheduleAnchorTimeIst ?? '07:00',
    'Schedule anchor time'
  );
  const scheduleIntervalMinutes = clampIntervalMinutes(input.scheduleIntervalMinutes);
  const scheduleDaysOfWeek = normalizeScheduleDays(input.scheduleDaysOfWeek);
  const scheduleWindowStartIst = normalizeOptionalTime(input.scheduleWindowStartIst);
  const scheduleWindowEndIst = normalizeOptionalTime(input.scheduleWindowEndIst);
  const toEmails = parseCommaEmails(input.toEmailsCsv);
  const ccEmails = parseCommaEmails(input.ccEmailsCsv ?? '');
  if (toEmails.length === 0) {
    throw new Error('At least one To email is required');
  }
  const org = await getMisEmailOrgSettings();
  assertAllowedEmailDomains([...toEmails, ...ccEmails], org.allowedEmailDomains);

  return withAppClient(async (client) => {
    const duplicate = await client.query<{ id: string }>(
      `SELECT id
       FROM public.mis_email_routing_rules
       WHERE upper(btrim(zone)) = $1
         AND upper(btrim(branch)) = $2
         AND upper(btrim(client)) = $3
         AND client_source_mode = $4
       LIMIT 1`,
      [normalizeKey(zone), normalizeKey(branch), normalizeKey(clientName), clientSourceMode]
    );
    if (duplicate.rows[0]) {
      throw new Error('Rule already exists for this zone/branch/client combination');
    }

    const res = await client.query<RuleRow>(
      `INSERT INTO public.mis_email_routing_rules
        (zone, branch, client, client_source_mode, schedule_anchor_time_ist, schedule_interval_minutes, schedule_days_of_week, schedule_window_start_ist, schedule_window_end_ist, to_emails, cc_emails, auto_send_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10::text[], $11::text[], $12)
       RETURNING id, zone, branch, client, client_source_mode, schedule_anchor_time_ist, schedule_interval_minutes, schedule_days_of_week, schedule_window_start_ist, schedule_window_end_ist, to_emails, cc_emails, auto_send_enabled, created_at, updated_at`,
      [
        zone,
        branch,
        clientName,
        clientSourceMode,
        scheduleAnchorTimeIst,
        scheduleIntervalMinutes,
        scheduleDaysOfWeek,
        scheduleWindowStartIst,
        scheduleWindowEndIst,
        toEmails,
        ccEmails,
        input.autoSendEnabled === true,
      ]
    );
    return rowToRule(res.rows[0]);
  });
}

export async function updateMisEmailRoutingRule(input: {
  id: string;
  zone?: string;
  branch?: string;
  client?: string;
  clientSourceMode?: MisEmailRoutingClientSourceMode;
  scheduleAnchorTimeIst?: string;
  scheduleIntervalMinutes?: number;
  scheduleDaysOfWeek?: string[];
  scheduleWindowStartIst?: string | null;
  scheduleWindowEndIst?: string | null;
  toEmailsCsv: string;
  ccEmailsCsv?: string;
  autoSendEnabled?: boolean;
}): Promise<MisEmailRoutingRule> {
  await ensureMisEmailRoutingRulesTable();
  const id = input.id.trim();
  if (!id) throw new Error('Rule id is required');
  const zone = normalizeText(input.zone ?? '');
  const branch = normalizeText(input.branch ?? '');
  const clientName = normalizeText(input.client ?? '');
  const clientSourceMode = normalizeMisEmailRoutingClientSourceMode(input.clientSourceMode);
  const scheduleAnchorTimeIst = normalizeTimeOrThrow(
    input.scheduleAnchorTimeIst ?? '07:00',
    'Schedule anchor time'
  );
  const scheduleIntervalMinutes = clampIntervalMinutes(input.scheduleIntervalMinutes);
  const scheduleDaysOfWeek = normalizeScheduleDays(input.scheduleDaysOfWeek);
  const scheduleWindowStartIst = normalizeOptionalTime(input.scheduleWindowStartIst);
  const scheduleWindowEndIst = normalizeOptionalTime(input.scheduleWindowEndIst);
  const toEmails = parseCommaEmails(input.toEmailsCsv);
  const ccEmails = parseCommaEmails(input.ccEmailsCsv ?? '');
  if (toEmails.length === 0) {
    throw new Error('At least one To email is required');
  }
  const org = await getMisEmailOrgSettings();
  assertAllowedEmailDomains([...toEmails, ...ccEmails], org.allowedEmailDomains);

  return withAppClient(async (client) => {
    const duplicate = await client.query<{ id: string }>(
      `SELECT id
       FROM public.mis_email_routing_rules
       WHERE upper(btrim(zone)) = $1
         AND upper(btrim(branch)) = $2
         AND upper(btrim(client)) = $3
         AND client_source_mode = $4
         AND id <> $5
       LIMIT 1`,
      [normalizeKey(zone), normalizeKey(branch), normalizeKey(clientName), clientSourceMode, id]
    );
    if (duplicate.rows[0]) {
      throw new Error('Rule already exists for this zone/branch/client combination');
    }

    const res = await client.query<RuleRow>(
      `UPDATE public.mis_email_routing_rules
       SET zone = $2,
           branch = $3,
           client = $4,
           client_source_mode = $5,
           schedule_anchor_time_ist = $6,
           schedule_interval_minutes = $7,
           schedule_days_of_week = $8::text[],
           schedule_window_start_ist = $9,
           schedule_window_end_ist = $10,
           to_emails = $11::text[],
           cc_emails = $12::text[],
           auto_send_enabled = $13,
           updated_at = now()
       WHERE id = $1
       RETURNING id, zone, branch, client, client_source_mode, schedule_anchor_time_ist, schedule_interval_minutes, schedule_days_of_week, schedule_window_start_ist, schedule_window_end_ist, to_emails, cc_emails, auto_send_enabled, created_at, updated_at`,
      [
        id,
        zone,
        branch,
        clientName,
        clientSourceMode,
        scheduleAnchorTimeIst,
        scheduleIntervalMinutes,
        scheduleDaysOfWeek,
        scheduleWindowStartIst,
        scheduleWindowEndIst,
        toEmails,
        ccEmails,
        input.autoSendEnabled === true,
      ]
    );
    if (!res.rows[0]) throw new Error('Rule not found');
    return rowToRule(res.rows[0]);
  });
}

export async function deleteMisEmailRoutingRule(id: string): Promise<void> {
  await ensureMisEmailRoutingRulesTable();
  const key = id.trim();
  if (!key) throw new Error('Rule id is required');
  await withAppClient(async (client) => {
    const res = await client.query(`DELETE FROM public.mis_email_routing_rules WHERE id = $1`, [key]);
    if ((res.rowCount ?? 0) === 0) throw new Error('Rule not found');
  });
}

type OfficeScopeRow = { region: string | null; vcompanyname: string | null };

export async function resolveRoutingScopeForOfficeIds(officeIdsRaw: string[]): Promise<{
  zones: string[];
  branches: string[];
}> {
  const officeIds = officeIdsRaw
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (officeIds.length === 0) return { zones: [], branches: [] };

  const officeRows = await withAppClient(async (client) => {
    const res = await client.query<OfficeScopeRow>(
      `SELECT region, vcompanyname
       FROM dim_offices
       WHERE ncode = ANY($1::bigint[])`,
      [officeIds]
    );
    return res.rows;
  });
  return {
    zones: officeRows.map((row) => normalizeKey(String(row.region ?? ''))).filter(Boolean),
    branches: officeRows.map((row) => normalizeKey(String(row.vcompanyname ?? ''))).filter(Boolean),
  };
}

/**
 * Office ncodes for composing a routing digest from the rule's Zone/Branch filters.
 * Empty array = all offices (catch-all rule).
 */
export async function resolveOfficeIdsForRoutingRule(
  rule: Pick<MisEmailRoutingRule, 'zone' | 'branch'>
): Promise<string[]> {
  const branchKeys = splitDimensionKeys(rule.branch);
  const zoneKeys = splitDimensionKeys(rule.zone);
  if (branchKeys.length === 0 && zoneKeys.length === 0) return [];

  return withAppClient(async (client) => {
    if (branchKeys.length > 0) {
      const res = await client.query<{ ncode: string }>(
        `SELECT ncode::text AS ncode
         FROM dim_offices
         WHERE upper(btrim(regexp_replace(coalesce(vcompanyname, ''), '\\s+', ' ', 'g'))) = ANY($1::text[])
         ORDER BY ncode`,
        [branchKeys]
      );
      return res.rows.map((r) => String(r.ncode)).filter(Boolean);
    }

    const res = await client.query<{ ncode: string }>(
      `SELECT ncode::text AS ncode
       FROM dim_offices
       WHERE upper(btrim(regexp_replace(coalesce(region, ''), '\\s+', ' ', 'g'))) = ANY($1::text[])
          OR upper(btrim(regexp_replace(
               regexp_replace(coalesce(region, ''), '\\s+', ' ', 'g'),
               '\\s+ZONE$', '', 'i'
             ))) = ANY($1::text[])
       ORDER BY ncode`,
      [zoneKeys]
    );
    return res.rows.map((r) => String(r.ncode)).filter(Boolean);
  });
}

function ruleMatchScore(
  rule: MisEmailRoutingRule,
  zones: Set<string>,
  branches: Set<string>,
  candidateClientKeys: Set<string>
): { score: number; totalKeys: number; createdAtMs: number } | null {
  const zoneKeys = splitDimensionKeys(rule.zone);
  const branchKeys = splitDimensionKeys(rule.branch);
  const ruleClientKeys = splitDimensionKeys(rule.client);

  if (zoneKeys.length > 0 && !zoneKeys.some((key) => zones.has(key))) return null;
  if (branchKeys.length > 0 && !branchKeys.some((key) => branches.has(key))) return null;
  if (ruleClientKeys.length > 0 && !ruleClientKeys.some((key) => candidateClientKeys.has(key))) return null;

  let score = 50;
  if (zoneKeys.length > 0 && branchKeys.length > 0 && ruleClientKeys.length > 0) score = 400;
  else if (zoneKeys.length > 0 && branchKeys.length > 0) score = 300;
  else if (zoneKeys.length > 0 && ruleClientKeys.length > 0) score = 200;
  else if (zoneKeys.length > 0) score = 100;
  else if (zoneKeys.length === 0 && branchKeys.length === 0 && ruleClientKeys.length === 0) score = 10;

  // Prefer narrower multi-select rules when dimension coverage is the same.
  const totalKeys = zoneKeys.length + branchKeys.length + ruleClientKeys.length;
  return {
    score,
    totalKeys,
    createdAtMs: Date.parse(rule.createdAt) || 0,
  };
}

export function pickBestMisEmailRoutingRule(params: {
  rules: MisEmailRoutingRule[];
  zones: string[];
  branches: string[];
  client: string | string[];
}): MisEmailRoutingRule | null {
  const zones = new Set(params.zones.map(normalizeKey).filter(Boolean));
  const branches = new Set(params.branches.map(normalizeKey).filter(Boolean));
  const clientKeys = new Set(
    (Array.isArray(params.client) ? params.client : [params.client]).map(normalizeKey).filter(Boolean)
  );

  let best: { rule: MisEmailRoutingRule; score: number; totalKeys: number; createdAtMs: number } | null = null;
  for (const rule of params.rules) {
    const metrics = ruleMatchScore(rule, zones, branches, clientKeys);
    if (!metrics) continue;
    if (!best || metrics.score > best.score) {
      best = { rule, ...metrics };
      continue;
    }
    if (!best || metrics.score !== best.score) continue;

    if (metrics.totalKeys < best.totalKeys) {
      best = { rule, ...metrics };
      continue;
    }
    if (metrics.totalKeys > best.totalKeys) continue;

    if (metrics.createdAtMs < best.createdAtMs) {
      best = { rule, ...metrics };
      continue;
    }
    if (metrics.createdAtMs > best.createdAtMs) continue;

    if (rule.id < best.rule.id) {
      best = { rule, ...metrics };
    }
  }
  return best?.rule ?? null;
}

function getIstDayCode(date = new Date()): string {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
  })
    .format(date)
    .toUpperCase();
  if (day.startsWith('MON')) return 'MON';
  if (day.startsWith('TUE')) return 'TUE';
  if (day.startsWith('WED')) return 'WED';
  if (day.startsWith('THU')) return 'THU';
  if (day.startsWith('FRI')) return 'FRI';
  if (day.startsWith('SAT')) return 'SAT';
  return 'SUN';
}

function getIstMinutes(date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

function minutesFromTime(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function shouldTriggerRoutingRuleNow(
  rule: MisEmailRoutingRule,
  options?: {
    now?: Date;
    windowMinutes?: number;
    /** Deprecated for digest: do not pass personal Profile sendTimeIst — it blasts HOD To/Cc. */
    sendTimeIst?: string | null;
  }
): boolean {
  const now = options?.now ?? new Date();
  const dayCode = getIstDayCode(now);
  if (!rule.scheduleDaysOfWeek.includes(dayCode)) return false;

  const nowMinutes = getIstMinutes(now);
  const override = typeof options?.sendTimeIst === 'string' ? options.sendTimeIst.trim() : '';
  const anchor = minutesFromTime(override || rule.scheduleAnchorTimeIst);
  const interval = Math.max(5, Math.floor(rule.scheduleIntervalMinutes));
  const windowMinutes = Math.max(1, Math.floor(options?.windowMinutes ?? 15));

  if (rule.scheduleWindowStartIst && rule.scheduleWindowEndIst) {
    const windowStart = minutesFromTime(rule.scheduleWindowStartIst);
    const windowEnd = minutesFromTime(rule.scheduleWindowEndIst);
    if (windowStart <= windowEnd) {
      if (nowMinutes < windowStart || nowMinutes > windowEnd) return false;
    } else {
      const inWrapped = nowMinutes >= windowStart || nowMinutes <= windowEnd;
      if (!inWrapped) return false;
    }
  }

  if (nowMinutes < anchor) return false;
  const delta = nowMinutes - anchor;
  // Half-open window: delta % interval in [0, window). Cron at 09:30 fires; 09:45 does not.
  return delta % interval < windowMinutes;
}

export async function logMisEmailRoutingSendAttempt(input: {
  ruleId: string;
  recipientId: string;
  recipientEmail: string;
  sentTo: string;
  status: 'sent' | 'failed' | 'skipped';
  error?: string;
}): Promise<void> {
  await ensureMisEmailRoutingRulesTable();
  await withAppClient(async (client) => {
    await client.query(
      `INSERT INTO public.mis_email_routing_send_log
       (rule_id, recipient_id, recipient_email, sent_to, status, error)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)`,
      [
        input.ruleId,
        input.recipientId,
        input.recipientEmail,
        input.sentTo,
        input.status,
        input.error ?? null,
      ]
    );
  });
}

/**
 * Start of the current schedule slot in absolute time (used to dedupe every-15-min
 * cron re-fires inside the same daily/interval window after a successful send).
 */
export function resolveRoutingScheduleSlotStart(
  rule: Pick<MisEmailRoutingRule, 'scheduleAnchorTimeIst' | 'scheduleIntervalMinutes'>,
  options?: { now?: Date; sendTimeIst?: string | null }
): Date {
  const now = options?.now ?? new Date();
  const override = typeof options?.sendTimeIst === 'string' ? options.sendTimeIst.trim() : '';
  const anchor = minutesFromTime(override || rule.scheduleAnchorTimeIst);
  const interval = Math.max(5, Math.floor(rule.scheduleIntervalMinutes));
  const nowMinutes = getIstMinutes(now);
  const delta = Math.max(0, nowMinutes - anchor);
  const slotOffset = delta - (delta % interval);
  const slotMinutes = anchor + slotOffset;

  const istDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const hh = String(Math.floor(slotMinutes / 60) % 24).padStart(2, '0');
  const mm = String(slotMinutes % 60).padStart(2, '0');
  // Interpret slot wall-clock as IST.
  return new Date(`${istDate}T${hh}:${mm}:00+05:30`);
}

/** True when this rule already had a successful SMTP send in the current slot (any trigger user). */
export async function hasSuccessfulRoutingSendInSlot(params: {
  ruleId: string;
  /** @deprecated Ignored — one rule blast per slot, not per digest recipient. */
  recipientId?: string;
  since: Date;
}): Promise<boolean> {
  await ensureMisEmailRoutingRulesTable();
  return withAppClient(async (client) => {
    const res = await client.query<{ ok: number }>(
      `SELECT 1 AS ok
       FROM public.mis_email_routing_send_log
       WHERE rule_id = $1::uuid
         AND status = 'sent'
         AND triggered_at >= $2::timestamptz
       LIMIT 1`,
      [params.ruleId, params.since.toISOString()]
    );
    return res.rows.length > 0;
  });
}

export async function resolveRoutingClientNamesForScope(params: {
  officeIds: string[];
  isHod: boolean;
  dateRangeMode?: 'yesterday' | 'month_to_date' | 'year_to_yesterday';
}): Promise<{ mail: string[]; crm: string[] }> {
  const dateRange = resolveDigestDateRangeForPreferences({
    dateRange: params.dateRangeMode ?? 'month_to_date',
  });
  const scope = {
    isHod: params.isHod,
    assignedOffices: params.officeIds,
    scopeLabel: params.isHod || params.officeIds.length === 0 ? 'All branches' : 'Selected branches',
  };
  const [mail, crm] = await Promise.all([
    queryDigestAccountNames(scope, dateRange),
    queryCrmDigestAccountNames(scope, dateRange),
  ]);
  return { mail, crm };
}

export function listMatchingMisEmailRoutingRulesForResolvedClients(params: {
  rules: MisEmailRoutingRule[];
  zones: string[];
  branches: string[];
  mailClients: string[];
  crmClients: string[];
}): MisEmailRoutingRule[] {
  const zones = new Set(params.zones.map(normalizeKey).filter(Boolean));
  const branches = new Set(params.branches.map(normalizeKey).filter(Boolean));
  const mailClients = new Set(params.mailClients.map(normalizeKey).filter(Boolean));
  const crmClients = new Set(params.crmClients.map(normalizeKey).filter(Boolean));

  return params.rules
    .map((rule) => ({
      rule,
      metrics: ruleMatchScore(
        rule,
        zones,
        branches,
        rule.clientSourceMode === 'crm' ? crmClients : mailClients
      ),
    }))
    .filter((item): item is { rule: MisEmailRoutingRule; metrics: NonNullable<ReturnType<typeof ruleMatchScore>> } => !!item.metrics)
    .sort((a, b) => {
      if (a.metrics.score !== b.metrics.score) return b.metrics.score - a.metrics.score;
      if (a.metrics.totalKeys !== b.metrics.totalKeys) return a.metrics.totalKeys - b.metrics.totalKeys;
      if (a.metrics.createdAtMs !== b.metrics.createdAtMs) return a.metrics.createdAtMs - b.metrics.createdAtMs;
      return a.rule.id.localeCompare(b.rule.id);
    })
    .map((item) => item.rule);
}
