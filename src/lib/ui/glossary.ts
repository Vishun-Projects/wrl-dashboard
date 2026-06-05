export type GlossaryTermId = 'ARCP' | 'BM' | 'ASP' | 'HOD' | 'FRN';

export const GLOSSARY: Record<GlossaryTermId, { label: string; definition: string }> = {
  ARCP: {
    label: 'ARCP',
    definition: 'Approved claim lines synced from CRM for reimbursement reporting.',
  },
  BM: {
    label: 'BM',
    definition: 'Branch Manager — approval stage before HO / finance processing.',
  },
  ASP: {
    label: 'ASP',
    definition: 'Authorized Service Partner (franchisee) handling the service call.',
  },
  HOD: {
    label: 'HOD',
    definition: 'Head of Department — HO-level approval on selected claim lines.',
  },
  FRN: {
    label: 'FRN',
    definition: 'Franchisee code identifying the ASP in CRM.',
  },
};
