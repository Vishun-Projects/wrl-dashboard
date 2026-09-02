/** Public surface for @/modules/mis-email — cross-domain imports must use this entry. */
export type { EmailAttachment } from './services/build-attachments';
export { defaultPreferencesForRecipient } from './services/preferences';
export { getMisEmailOrgSettings } from './services/org-settings';
export { canManageMisEmailRouting } from './services/routing-rules';
export { sendHtmlEmail } from './services/send';
