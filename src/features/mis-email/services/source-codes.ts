/**
 * Client-import sources for MIS email (no Node/pg dependencies).
 * CRM Cadbury/Mondelez is subtracted in the BD MIS union and replaced by Mondelez import.
 */
export const MIS_EMAIL_CLIENT_SOURCE_CODES = ['cadbury', 'coke'] as const;

export type MisEmailClientSourceCode = (typeof MIS_EMAIL_CLIENT_SOURCE_CODES)[number];
