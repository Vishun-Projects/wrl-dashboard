import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { canAccessPage } from '@/lib/auth/rbac-catalog';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { jsonSafeError, safeErrorMessage } from '@/lib/api/safe-error';
import { logAccessDenied, logAction } from '@/lib/security/audit';

import {
  listSubcontractorSkipRules,
  createSubcontractorSkipRule,
  deleteSubcontractorSkipRule,
  listSubcontractorRecipients,
  createSubcontractorRecipient,
  updateSubcontractorRecipient,
  deleteSubcontractorRecipient,
  getSubcontractorConfig,
  setSubcontractorConfig,
  getTodaySubcontractorRun,
} from '../../services/settings';

import {
  fetchCrmPlants,
  fetchCrmVendors,
  fetchCrmActiveMaterials,
} from '../../services/crm-query';

import { runSubcontractorReconciliation } from '../../services/reconcile-runner';
import { triggerSubcontractorEmails } from '../../services/email-sender'; // We will create this!

const SYSTEM_ACTOR = {
  userId: null,
  email: 'system:subcontractor-stock-api',
  name: 'Subcontractor Stock API',
};

async function requireAccess(request: Request): Promise<
  | { error: NextResponse; auth?: never; user?: never }
  | { auth: any; user: any; error?: never }
> {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'subcon_settings_unauthorized' });
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const auth = await loadUserAuth(user.id);
  if (!auth) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      statusCode: 401,
      reason: 'subcon_settings_unauthorized',
    });
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  // Gate using the page_mis_email_settings permission
  if (!canAccessPage(auth.permissions, 'mis_email_settings')) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: auth.profile.email ?? null,
      statusCode: 403,
      reason: 'subcon_settings_forbidden',
    });
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { auth, user };
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const access = await requireAccess(request);
    if (access.error) return access.error;

    const { searchParams } = new URL(request.url);
    const options = searchParams.get('options');

    if (options === 'true' || options === '1') {
      const [plants, vendors, materials] = await Promise.all([
        fetchCrmPlants().catch(() => []),
        fetchCrmVendors().catch(() => []),
        fetchCrmActiveMaterials().catch(() => []),
      ]);
      return NextResponse.json({ plants, vendors, materials });
    }

    const [skipRules, recipients, sendTime, todayRun] = await Promise.all([
      listSubcontractorSkipRules(),
      listSubcontractorRecipients(),
      getSubcontractorConfig('send_time_ist').then((val) => val || '08:00'),
      getTodaySubcontractorRun(),
    ]);

    return NextResponse.json({ skipRules, recipients, sendTime, todayRun });
  } catch (err: any) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const access = await requireAccess(request);
    if (access.error) return access.error;
    await assertSameOriginMutation(request);

    const body = await request.json();
    const { type, action, data } = body;

    const actor = {
      userId: access.user.id,
      email: access.auth.profile.email,
      name: access.auth.profile.name,
    };

    if (action === 'run-reconciliation') {
      // Find files for today (usually in e:\database\fast-close-app\extracted_sap or /tmp/extracted_sap)
      // For local development, search for any HTML files in extracted_sap
      const fs = require('fs');
      const path = require('path');
      const glob = require('glob');
      const os = require('os');

      const isVPS = os.hostname().startsWith('srv') || fs.existsSync('/home/mis');
      const searchDir = isVPS ? '/tmp/extracted_sap' : path.resolve(process.cwd(), 'extracted_sap');
      
      const htmFiles = glob.sync(`${searchDir}/*.htm*`);
      if (htmFiles.length === 0) {
        return NextResponse.json(
          { error: `No SAP HTML files found to reconcile in: ${searchDir}` },
          { status: 400 }
        );
      }

      // Reconcile using the first file or merge all?
      // Since they come in multiple parts, let's run the runner!
      // The runner expects a single filePath or we can merge/parse them.
      // Wait, let's use the first file for simplicity or let the runner handle it.
      // Wait! In reconcile-today-excel.ts, it reads all .htm files, parses them, merges them, and reconciles.
      // Let's make sure our runner or custom endpoint does this!
      // We will create a helper to run today's reconciliation.
      const { runTodayReconciliation } = await import('../../services/reconcile-runner');
      const result = await runTodayReconciliation();

      await logAction({
        action: 'subcontractor_stock.reconcile_manual',
        actor,
        result: 'success',
        summary: `Manually executed subcontractor stock reconciliation for today`,
        metadata: { summary: result.summary },
      });

      return NextResponse.json({ success: true, summary: result.summary, todayRun: result.run });
    }

    if (action === 'send-emails') {
      const result = await triggerSubcontractorEmails({ force: true });
      await logAction({
        action: 'subcontractor_stock.send_emails_manual',
        actor,
        result: 'success',
        summary: `Manually sent subcontractor stock reconciliation emails`,
        metadata: { sentCount: result.sentCount },
      });
      return NextResponse.json({ success: true, sentCount: result.sentCount });
    }

    if (type === 'skip-rule') {
      if (Array.isArray(data)) {
        const rules = [];
        for (const item of data) {
          const rule = await createSubcontractorSkipRule(item);
          rules.push(rule);
        }
        await logAction({
          action: 'subcontractor_stock.skip_rule.create_bulk',
          actor,
          result: 'success',
          summary: `Added ${rules.length} skip rules in bulk`,
          metadata: { count: rules.length, rules },
        });
        return NextResponse.json(rules);
      } else {
        const rule = await createSubcontractorSkipRule(data);
        await logAction({
          action: 'subcontractor_stock.skip_rule.create',
          actor,
          result: 'success',
          summary: `Added skip rule: ${rule.type} - ${rule.code}`,
          metadata: { rule },
        });
        return NextResponse.json(rule);
      }
    }

    if (type === 'recipient') {
      const recipient = await createSubcontractorRecipient(data);
      await logAction({
        action: 'subcontractor_stock.recipient.create',
        actor,
        result: 'success',
        summary: `Added subcontractor recipient: ${recipient.recipientName} (${recipient.email}) for plant ${recipient.plantCode}`,
        metadata: { recipient },
      });
      return NextResponse.json(recipient);
    }

    return NextResponse.json({ error: 'Invalid POST body' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const access = await requireAccess(request);
    if (access.error) return access.error;
    await assertSameOriginMutation(request);

    const body = await request.json();
    const { type, data } = body;

    const actor = {
      userId: access.user.id,
      email: access.auth.profile.email,
      name: access.auth.profile.name,
    };

    if (type === 'recipient') {
      const recipient = await updateSubcontractorRecipient(data.id, data);
      await logAction({
        action: 'subcontractor_stock.recipient.update',
        actor,
        result: 'success',
        summary: `Updated subcontractor recipient: ${recipient.recipientName} (${recipient.email})`,
        metadata: { recipient },
      });
      return NextResponse.json(recipient);
    }

    if (type === 'config') {
      await setSubcontractorConfig(data.key, data.value);
      await logAction({
        action: 'subcontractor_stock.config.update',
        actor,
        result: 'success',
        summary: `Updated subcontractor config key: ${data.key} to ${data.value}`,
        metadata: { key: data.key, value: data.value },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid PUT body' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const access = await requireAccess(request);
    if (access.error) return access.error;
    await assertSameOriginMutation(request);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const type = searchParams.get('type');

    if (!id || !type) {
      return NextResponse.json({ error: 'Missing id or type parameters' }, { status: 400 });
    }

    const actor = {
      userId: access.user.id,
      email: access.auth.profile.email,
      name: access.auth.profile.name,
    };

    if (type === 'skip-rule') {
      await deleteSubcontractorSkipRule(id);
      await logAction({
        action: 'subcontractor_stock.skip_rule.delete',
        actor,
        result: 'success',
        summary: `Deleted subcontractor skip rule id: ${id}`,
      });
    } else if (type === 'recipient') {
      await deleteSubcontractorRecipient(id);
      await logAction({
        action: 'subcontractor_stock.recipient.delete',
        actor,
        result: 'success',
        summary: `Deleted subcontractor recipient id: ${id}`,
      });
    } else {
      return NextResponse.json({ error: 'Invalid delete type' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
