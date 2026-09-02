import {
  createBranchRecipientStore,
  listBranchOptionsForRecipients,
  type BranchRecipient,
} from '@/modules/mis-email/server/sync/branch-recipient-store';
import {
  normalizeBranchKey,
  normalizeRecipientEmail,
} from '@/modules/mis-email/server/sync/branch-recipient-utils';

const store = createBranchRecipientStore({
  table: 'major_repair_repeat_recipients',
  uniqueIndex: 'uq_major_repair_repeat_recipients_branch_email',
  branchIndex: 'idx_major_repair_repeat_recipients_branch',
});

export type MajorRepairRepeatRecipient = BranchRecipient;

export { normalizeBranchKey, normalizeRecipientEmail, listBranchOptionsForRecipients };

export const ensureMajorRepairRepeatRecipientsTable = store.ensureTable;
export const listMajorRepairRepeatRecipients = store.list;
export const getMajorRepairRepeatRecipient = store.get;
export const listEnabledEmailsForBranch = store.listEnabledForBranch;
export const createMajorRepairRepeatRecipient = store.create;
export const updateMajorRepairRepeatRecipient = store.update;
export const deleteMajorRepairRepeatRecipient = store.remove;

/** Branch enabled To wins; HQ To/Cc become Cc (or sole To if no branch rows). */
export function resolveAlertRecipients(params: {
  branchEmails: string[];
  hqTo: string;
  hqCc: string;
}): { to: string[]; cc: string[] } {
  const branch = [...new Set(params.branchEmails.map(normalizeRecipientEmail).filter(Boolean))];
  const hqTo = normalizeRecipientEmail(params.hqTo);
  const hqCc = normalizeRecipientEmail(params.hqCc);
  const hq = [...new Set([hqTo, hqCc].filter(Boolean))];

  if (branch.length > 0) {
    const to = branch;
    const cc = hq.filter((e) => !to.includes(e));
    return { to, cc };
  }
  return {
    to: hqTo ? [hqTo] : [],
    cc: hqCc && hqCc !== hqTo ? [hqCc] : [],
  };
}
