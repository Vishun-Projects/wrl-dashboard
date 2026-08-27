import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { canAccessPage } from '@/lib/auth/rbac-catalog';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { safeErrorMessage } from '@/lib/api/safe-error';
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
  listRecentSubcontractorRuns,
  listSapMailLog,
} from '../../services/settings';

import {
  fetchCrmPlants,
  fetchCrmVendors,
  fetchCrmActiveMaterials,
} from '../../services/crm-query';

import { triggerSubcontractorEmails } from '../../services/email-sender';
import { runTodayReconciliation } from '../../services/reconcile-runner';
import { getSapInboxDashboard, syncSapMailInbox } from '../../services/sap-inbox';
import {
  isSubcontractorVpsHost,
  relaySubcontractorReconcile,
  relaySubcontractorSend,
  relaySubcontractorSyncInbox,
} from '@/lib/mail/subcontractor-relay-client';

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
    const inbox = searchParams.get('inbox');

    if (options === 'true' || options === '1') {
      const [plants, vendors, materials] = await Promise.all([
        fetchCrmPlants().catch(() => []),
        fetchCrmVendors().catch(() => []),
        fetchCrmActiveMaterials().catch(() => []),
      ]);
      return NextResponse.json({ plants, vendors, materials });
    }

    if (inbox === 'true' || inbox === '1') {
      const days = Math.min(Math.max(Number(searchParams.get('days') ?? 14) || 14, 1), 90);
      const [dashboard, todayRun, recentRuns] = await Promise.all([
        getSapInboxDashboard(days),
        getTodaySubcontractorRun(),
        listRecentSubcontractorRuns(14),
      ]);
      return NextResponse.json({
        inbox: dashboard.inbox,
        todayMailCount: dashboard.todayMailCount,
        latestReceivedAt: dashboard.latestReceivedAt,
        todayRun,
        recentRuns,
      });
    }

    const [skipRules, recipients, sendTime, todayRun, recentRuns] = await Promise.all([
      listSubcontractorSkipRules(),
      listSubcontractorRecipients(),
      getSubcontractorConfig('send_time_ist').then((val) => val || '08:00'),
      getTodaySubcontractorRun(),
      listRecentSubcontractorRuns(14),
    ]);

    const inboxEntries = await listSapMailLog({ days: 14 });

    return NextResponse.json({
      skipRules,
      recipients,
      sendTime,
      todayRun,
      recentRuns,
      inbox: inboxEntries,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const access = await requireAccess(request);
    if (access.error) return access.error;
    await assertSameOriginMutation(request);

    const body = await request.json();
    const { type, action, data, mailKeys, recipientIds } = body;

    const actor = {
      userId: access.user.id,
      email: access.auth.profile.email,
      name: access.auth.profile.name,
    };

    if (action === 'sync-inbox') {
      if (isSubcontractorVpsHost()) {
        const result = await syncSapMailInbox();
        await logAction({
          action: 'subcontractor_stock.sync_inbox',
          actor,
          result: 'success',
          summary: 'Synced SAP mail inbox on VPS',
          metadata: { upserted: result.upserted },
        });
        return NextResponse.json({
          success: true,
          upserted: result.upserted,
          inbox: result.entries,
        });
      }

      const relay = await relaySubcontractorSyncInbox();
      await logAction({
        action: 'subcontractor_stock.sync_inbox',
        actor,
        result: 'success',
        summary: 'Synced SAP mail inbox via VPS relay',
        metadata: { upserted: relay.data.upserted },
      });
      return NextResponse.json({
        success: true,
        upserted: relay.data.upserted,
        inbox: relay.data.entries ?? [],
      });
    }

    if (action === 'run-reconciliation') {
      const keys = Array.isArray(mailKeys)
        ? mailKeys.map((k: string) => String(k).trim()).filter(Boolean)
        : undefined;

      if (isSubcontractorVpsHost()) {
        const result = await runTodayReconciliation(
          keys && keys.length > 0 ? { mailKeys: keys } : {}
        );
        await logAction({
          action: 'subcontractor_stock.reconcile_manual',
          actor,
          result: 'success',
          summary: 'Manually executed subcontractor stock reconciliation',
          metadata: { summary: result.summary, mailKeys: keys },
        });
        return NextResponse.json({ success: true, summary: result.summary, todayRun: result.run });
      }

      const relay = await relaySubcontractorReconcile(
        keys && keys.length > 0 ? { mailKeys: keys } : {}
      );
      if (relay.data.error) {
        return NextResponse.json({ error: relay.data.error }, { status: 502 });
      }
      await logAction({
        action: 'subcontractor_stock.reconcile_manual',
        actor,
        result: 'success',
        summary: 'Manually executed subcontractor stock reconciliation via VPS relay',
        metadata: { summary: relay.data.summary, mailKeys: keys },
      });
      return NextResponse.json({
        success: true,
        summary: relay.data.summary,
        todayRun: relay.data.todayRun,
      });
    }

    if (action === 'send-emails') {
      const ids = Array.isArray(recipientIds)
        ? recipientIds.map((id: string) => String(id).trim()).filter(Boolean)
        : undefined;

      if (isSubcontractorVpsHost()) {
        const result = await triggerSubcontractorEmails({
          force: true,
          recipientIds: ids,
        });
        await logAction({
          action: 'subcontractor_stock.send_emails_manual',
          actor,
          result: 'success',
          summary: 'Manually sent subcontractor stock reconciliation emails',
          metadata: { sentCount: result.sentCount, recipientIds: ids },
        });
        return NextResponse.json({ success: true, sentCount: result.sentCount });
      }

      if (!ids || ids.length === 0) {
        return NextResponse.json(
          { error: 'Select at least one recipient for manual send from the portal.' },
          { status: 400 }
        );
      }

      const relay = await relaySubcontractorSend({ recipientIds: ids, force: true });
      if (relay.data.error) {
        return NextResponse.json({ error: relay.data.error }, { status: 502 });
      }
      await logAction({
        action: 'subcontractor_stock.send_emails_manual',
        actor,
        result: 'success',
        summary: 'Manually sent subcontractor stock emails via VPS relay',
        metadata: { sentCount: relay.data.sentCount, recipientIds: ids },
      });
      return NextResponse.json({ success: true, sentCount: relay.data.sentCount });
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
  } catch (err: unknown) {
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
  } catch (err: unknown) {
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
  } catch (err: unknown) {
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
