import { createBranchRecipientRouteHandlers } from '@/modules/mis-email/server/routes/branch-recipient-routes';
import {
  createCancelledCallDigestRecipient,
  deleteCancelledCallDigestRecipient,
  getCancelledCallDigestRecipient,
  listCancelledCallDigestRecipients,
  updateCancelledCallDigestRecipient,
} from '@/modules/mis-email/server/sync/cancelled-call-digest-recipients';

const handlers = createBranchRecipientRouteHandlers({
  pageId: 'cancelled_call_alerts',
  unauthorizedReason: 'cancelled_call_digest_recipients_unauthorized',
  forbiddenReason: 'cancelled_call_digest_recipients_forbidden',
  auditType: 'cancelled_call_digest_recipient',
  auditLabel: 'cancelled-call digest recipient',
  list: listCancelledCallDigestRecipients,
  get: getCancelledCallDigestRecipient,
  create: createCancelledCallDigestRecipient,
  update: updateCancelledCallDigestRecipient,
  remove: deleteCancelledCallDigestRecipient,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
