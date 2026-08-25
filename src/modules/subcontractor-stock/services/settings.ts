import { withAppClient } from '@/lib/read-model/db';
import { assertAllowedEmailDomains } from '@/lib/mail/allowed-domains';
import { getMisEmailOrgSettings } from '@/modules/mis-email';

export type SubcontractorSkipRule = {
  id: string;
  type: 'PLANT' | 'VENDOR' | 'MATERIAL';
  code: string;
  description: string;
  createdAt: string;
};

export type SubcontractorRecipient = {
  id: string;
  recipientName: string;
  email: string;
  plantCode: string;
  enabled: boolean;
  reportFilter: 'all' | 'positive' | 'negative';
  createdAt: string;
  updatedAt: string;
};

export type SubcontractorRun = {
  id: string;
  runDate: string; // YYYY-MM-DD
  reconciledAt: string | null;
  emailSentAt: string | null;
  summary: any | null;
  excelFilename: string | null;
  createdAt: string;
};

let ensured = false;

export async function ensureSubcontractorStockSettingsTables(): Promise<void> {
  if (ensured) return;
  await withAppClient(async (client) => {
    // 1. Create Skip Rules table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.subcontractor_stock_skip_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type text NOT NULL CHECK (type IN ('PLANT', 'VENDOR', 'MATERIAL')),
        code text NOT NULL,
        description text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_subcontractor_stock_skip_rules_type_code UNIQUE (type, code)
      );
    `);

    // 2. Create Recipients table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.subcontractor_stock_recipients (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        recipient_name text NOT NULL,
        email text NOT NULL,
        plant_code text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        report_filter text NOT NULL DEFAULT 'all' CHECK (report_filter IN ('all', 'positive', 'negative')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_subcontractor_stock_recipients_plant_email UNIQUE (plant_code, email)
      );
    `);

    // Ensure column exists for older schema installations
    await client.query(`
      ALTER TABLE public.subcontractor_stock_recipients
      ADD COLUMN IF NOT EXISTS report_filter text NOT NULL DEFAULT 'all' CHECK (report_filter IN ('all', 'positive', 'negative'));
    `);

    // 3. Create Config table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.subcontractor_stock_config (
        key text PRIMARY KEY,
        value text NOT NULL
      );
    `);

    // Initialize default send time
    await client.query(`
      INSERT INTO public.subcontractor_stock_config (key, value)
      VALUES ('send_time_ist', '08:00')
      ON CONFLICT (key) DO NOTHING;
    `);

    // 4. Create Run Tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.subcontractor_stock_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        run_date date NOT NULL UNIQUE DEFAULT CURRENT_DATE,
        reconciled_at timestamptz,
        email_sent_at timestamptz,
        summary jsonb,
        excel_filename text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  });
  ensured = true;
}

// --- SKIP RULES ---

export async function listSubcontractorSkipRules(): Promise<SubcontractorSkipRule[]> {
  await ensureSubcontractorStockSettingsTables();
  return withAppClient(async (client) => {
    const res = await client.query(`
      SELECT id, type, code, description, created_at
      FROM public.subcontractor_stock_skip_rules
      ORDER BY type, code
    `);
    return res.rows.map((row) => ({
      id: row.id,
      type: row.type as 'PLANT' | 'VENDOR' | 'MATERIAL',
      code: row.code,
      description: row.description,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  });
}

export async function createSubcontractorSkipRule(params: {
  type: 'PLANT' | 'VENDOR' | 'MATERIAL';
  code: string;
  description?: string;
}): Promise<SubcontractorSkipRule> {
  await ensureSubcontractorStockSettingsTables();
  const cleanCode = params.code.trim();
  if (!cleanCode) throw new Error('Code is required');

  return withAppClient(async (client) => {
    const res = await client.query(
      `
      INSERT INTO public.subcontractor_stock_skip_rules (type, code, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (type, code) DO UPDATE 
      SET description = EXCLUDED.description
      RETURNING id, type, code, description, created_at
      `,
      [params.type, cleanCode, (params.description || '').trim()]
    );
    const row = res.rows[0];
    return {
      id: row.id,
      type: row.type as 'PLANT' | 'VENDOR' | 'MATERIAL',
      code: row.code,
      description: row.description,
      createdAt: new Date(row.created_at).toISOString(),
    };
  });
}

export async function deleteSubcontractorSkipRule(id: string): Promise<void> {
  await ensureSubcontractorStockSettingsTables();
  await withAppClient(async (client) => {
    await client.query('DELETE FROM public.subcontractor_stock_skip_rules WHERE id = $1', [id]);
  });
}

// --- RECIPIENTS ---

export async function listSubcontractorRecipients(): Promise<SubcontractorRecipient[]> {
  await ensureSubcontractorStockSettingsTables();
  return withAppClient(async (client) => {
    const res = await client.query(`
      SELECT id, recipient_name, email, plant_code, enabled, report_filter, created_at, updated_at
      FROM public.subcontractor_stock_recipients
      ORDER BY plant_code, email
    `);
    return res.rows.map((row) => ({
      id: row.id,
      recipientName: row.recipient_name,
      email: row.email,
      plantCode: row.plant_code,
      enabled: row.enabled,
      reportFilter: (row.report_filter || 'all') as 'all' | 'positive' | 'negative',
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  });
}

export async function createSubcontractorRecipient(params: {
  recipientName: string;
  email: string;
  plantCode: string;
  enabled?: boolean;
  reportFilter?: 'all' | 'positive' | 'negative';
}): Promise<SubcontractorRecipient> {
  await ensureSubcontractorStockSettingsTables();
  const cleanEmail = params.email.trim().toLowerCase();
  const cleanPlant = params.plantCode.trim();
  const cleanName = params.recipientName.trim();

  if (!cleanName) throw new Error('Recipient name is required');
  if (!cleanEmail) throw new Error('Email is required');
  if (!cleanPlant) throw new Error('Plant code is required');

  const org = await getMisEmailOrgSettings();
  await assertAllowedEmailDomains([cleanEmail], org.allowedEmailDomains);

  return withAppClient(async (client) => {
    const res = await client.query(
      `
      INSERT INTO public.subcontractor_stock_recipients (recipient_name, email, plant_code, enabled, report_filter)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (plant_code, email) DO UPDATE
      SET recipient_name = EXCLUDED.recipient_name,
          enabled = EXCLUDED.enabled,
          report_filter = EXCLUDED.report_filter,
          updated_at = now()
      RETURNING id, recipient_name, email, plant_code, enabled, report_filter, created_at, updated_at
      `,
      [cleanName, cleanEmail, cleanPlant, params.enabled ?? true, params.reportFilter || 'all']
    );
    const row = res.rows[0];
    return {
      id: row.id,
      recipientName: row.recipient_name,
      email: row.email,
      plantCode: row.plant_code,
      enabled: row.enabled,
      reportFilter: (row.report_filter || 'all') as 'all' | 'positive' | 'negative',
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  });
}

export async function updateSubcontractorRecipient(
  id: string,
  params: {
    recipientName?: string;
    email?: string;
    plantCode?: string;
    enabled?: boolean;
    reportFilter?: 'all' | 'positive' | 'negative';
  }
): Promise<SubcontractorRecipient> {
  await ensureSubcontractorStockSettingsTables();
  
  if (params.email) {
    const cleanEmail = params.email.trim().toLowerCase();
    const org = await getMisEmailOrgSettings();
    await assertAllowedEmailDomains([cleanEmail], org.allowedEmailDomains);
  }

  return withAppClient(async (client) => {
    const currentRes = await client.query(
      'SELECT id, recipient_name, email, plant_code, enabled, report_filter FROM public.subcontractor_stock_recipients WHERE id = $1',
      [id]
    );
    if (currentRes.rows.length === 0) throw new Error('Recipient not found');
    const curr = currentRes.rows[0];

    const nextName = params.recipientName !== undefined ? params.recipientName.trim() : curr.recipient_name;
    const nextEmail = params.email !== undefined ? params.email.trim().toLowerCase() : curr.email;
    const nextPlant = params.plantCode !== undefined ? params.plantCode.trim() : curr.plant_code;
    const nextEnabled = params.enabled !== undefined ? params.enabled : curr.enabled;
    const nextFilter = params.reportFilter !== undefined ? params.reportFilter : (curr.report_filter || 'all');

    if (!nextName) throw new Error('Name is required');
    if (!nextEmail) throw new Error('Email is required');
    if (!nextPlant) throw new Error('Plant code is required');

    const res = await client.query(
      `
      UPDATE public.subcontractor_stock_recipients
      SET recipient_name = $1,
          email = $2,
          plant_code = $3,
          enabled = $4,
          report_filter = $5,
          updated_at = now()
      WHERE id = $6
      RETURNING id, recipient_name, email, plant_code, enabled, report_filter, created_at, updated_at
      `,
      [nextName, nextEmail, nextPlant, nextEnabled, nextFilter, id]
    );
    const row = res.rows[0];
    return {
      id: row.id,
      recipientName: row.recipient_name,
      email: row.email,
      plantCode: row.plant_code,
      enabled: row.enabled,
      reportFilter: (row.report_filter || 'all') as 'all' | 'positive' | 'negative',
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  });
}

export async function deleteSubcontractorRecipient(id: string): Promise<void> {
  await ensureSubcontractorStockSettingsTables();
  await withAppClient(async (client) => {
    await client.query('DELETE FROM public.subcontractor_stock_recipients WHERE id = $1', [id]);
  });
}

// --- CONFIG ---

export async function getSubcontractorConfig(key: string): Promise<string | null> {
  await ensureSubcontractorStockSettingsTables();
  return withAppClient(async (client) => {
    const res = await client.query('SELECT value FROM public.subcontractor_stock_config WHERE key = $1', [key]);
    return res.rows[0]?.value ?? null;
  });
}

export async function setSubcontractorConfig(key: string, value: string): Promise<void> {
  await ensureSubcontractorStockSettingsTables();
  await withAppClient(async (client) => {
    await client.query(
      `
      INSERT INTO public.subcontractor_stock_config (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `,
      [key, value.trim()]
    );
  });
}

export function getIstLocalDateStr(date: Date = new Date()): string {
  const offset = 5.5 * 60 * 60 * 1000; // IST is UTC + 5:30
  const istDate = new Date(date.getTime() + offset);
  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// --- EXECUTION RUNS ---

export async function getTodaySubcontractorRun(dateStr?: string): Promise<SubcontractorRun | null> {
  await ensureSubcontractorStockSettingsTables();
  const targetDate = dateStr || getIstLocalDateStr();
  return withAppClient(async (client) => {
    const res = await client.query(
      `
      SELECT id, run_date, reconciled_at, email_sent_at, summary, excel_filename, created_at
      FROM public.subcontractor_stock_runs
      WHERE run_date = $1
      `,
      [targetDate]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      runDate: row.run_date instanceof Date ? row.run_date.toISOString().split('T')[0] : String(row.run_date),
      reconciledAt: row.reconciled_at ? new Date(row.reconciled_at).toISOString() : null,
      emailSentAt: row.email_sent_at ? new Date(row.email_sent_at).toISOString() : null,
      summary: row.summary,
      excelFilename: row.excel_filename,
      createdAt: new Date(row.created_at).toISOString(),
    };
  });
}

export async function upsertSubcontractorReconciledRun(params: {
  dateStr?: string;
  summary: any;
  excelFilename: string;
}): Promise<SubcontractorRun> {
  await ensureSubcontractorStockSettingsTables();
  const targetDate = params.dateStr || getIstLocalDateStr();
  return withAppClient(async (client) => {
    const res = await client.query(
      `
      INSERT INTO public.subcontractor_stock_runs (run_date, reconciled_at, summary, excel_filename)
      VALUES ($1, now(), $2, $3)
      ON CONFLICT (run_date) DO UPDATE
      SET reconciled_at = now(),
          summary = EXCLUDED.summary,
          excel_filename = EXCLUDED.excel_filename
      RETURNING id, run_date, reconciled_at, email_sent_at, summary, excel_filename, created_at
      `,
      [targetDate, JSON.stringify(params.summary), params.excelFilename]
    );
    const row = res.rows[0];
    return {
      id: row.id,
      runDate: row.run_date instanceof Date ? row.run_date.toISOString().split('T')[0] : String(row.run_date),
      reconciledAt: row.reconciled_at ? new Date(row.reconciled_at).toISOString() : null,
      emailSentAt: row.email_sent_at ? new Date(row.email_sent_at).toISOString() : null,
      summary: row.summary,
      excelFilename: row.excel_filename,
      createdAt: new Date(row.created_at).toISOString(),
    };
  });
}

export async function markSubcontractorRunEmailSent(dateStr?: string): Promise<void> {
  await ensureSubcontractorStockSettingsTables();
  const targetDate = dateStr || getIstLocalDateStr();
  await withAppClient(async (client) => {
    await client.query(
      `
      UPDATE public.subcontractor_stock_runs
      SET email_sent_at = now()
      WHERE run_date = $1
      `,
      [targetDate]
    );
  });
}

