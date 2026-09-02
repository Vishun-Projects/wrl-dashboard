import { createBranchRecipientRouteHandlers } from '@/modules/mis-email/server/routes/branch-recipient-routes';
import {
  createMajorRepairRepeatRecipient,
  deleteMajorRepairRepeatRecipient,
  getMajorRepairRepeatRecipient,
  listMajorRepairRepeatRecipients,
  updateMajorRepairRepeatRecipient,
} from '@/modules/mis-email/server/sync/major-repair-repeat-recipients';

const handlers = createBranchRecipientRouteHandlers({
  pageId: 'major_repair_alerts',
  unauthorizedReason: 'major_repair_recipients_unauthorized',
  forbiddenReason: 'major_repair_recipients_forbidden',
  auditType: 'major_repair_recipient',
  auditLabel: 'major-repair recipient',
  list: listMajorRepairRepeatRecipients,
  get: getMajorRepairRepeatRecipient,
  create: createMajorRepairRepeatRecipient,
  update: updateMajorRepairRepeatRecipient,
  remove: deleteMajorRepairRepeatRecipient,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
