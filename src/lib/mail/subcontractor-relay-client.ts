import {
  relayPostJson,
  resolveVpsMailRelaySecret,
  type RelayPostResult,
} from '@/lib/mail/relay-client';
import type { SapMailLogEntry } from '@/modules/subcontractor-stock/services/settings';
import type { SubcontractorRun } from '@/modules/subcontractor-stock/services/settings';
import type { ReconciliationSummary } from '@/modules/subcontractor-stock/services/reconciliation-engine';

const SAP_INBOX_SYNC_PATH = '/internal/mail/subcontractor-sap-inbox/sync';
const SAP_RECONCILE_PATH = '/internal/mail/subcontractor-reconcile';
const SAP_SEND_PATH = '/internal/mail/subcontractor-send';

export type SubcontractorRelayInboxResponse = {
  ok?: boolean;
  upserted?: number;
  entries?: SapMailLogEntry[];
  error?: string;
};

export type SubcontractorRelayReconcileResponse = {
  ok?: boolean;
  summary?: ReconciliationSummary;
  todayRun?: SubcontractorRun;
  error?: string;
};

export type SubcontractorRelaySendResponse = {
  ok?: boolean;
  sentCount?: number;
  error?: string;
};

function requireRelaySecret(): string {
  const secret = resolveVpsMailRelaySecret();
  if (!secret) {
    throw new Error(
      'VPS_MAIL_RELAY_SECRET is not configured — manual SAP actions require VPS relay.'
    );
  }
  return secret;
}

export async function relaySubcontractorSyncInbox(): Promise<
  RelayPostResult<SubcontractorRelayInboxResponse>
> {
  return relayPostJson<SubcontractorRelayInboxResponse>(
    SAP_INBOX_SYNC_PATH,
    {},
    requireRelaySecret()
  );
}

export async function relaySubcontractorReconcile(body: {
  mailKeys?: string[];
}): Promise<RelayPostResult<SubcontractorRelayReconcileResponse>> {
  return relayPostJson<SubcontractorRelayReconcileResponse>(
    SAP_RECONCILE_PATH,
    body,
    requireRelaySecret()
  );
}

export async function relaySubcontractorSend(body: {
  recipientIds: string[];
  force?: boolean;
}): Promise<RelayPostResult<SubcontractorRelaySendResponse>> {
  return relayPostJson<SubcontractorRelaySendResponse>(
    SAP_SEND_PATH,
    body,
    requireRelaySecret()
  );
}

export { isSubcontractorVpsHost } from '@/modules/subcontractor-stock/services/vps-host';
