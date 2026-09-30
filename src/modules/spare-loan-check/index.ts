export { lookupPlantMeta } from '@/modules/spare-loan-check/crm-match';
export { lookupCallsByVtrnno } from '@/modules/spare-loan-check/crm-match';
export {
  classifySpareLoanRow,
  selectMatchKey,
} from '@/modules/spare-loan-check/crm-match';
export { parseZss02Html } from '@/modules/spare-loan-check/parse-html';
export {
  isPlantInScope,
  resolveAllowedSpareLoanPlants,
} from '@/modules/spare-loan-check/plant-scope';
export type { Zss02ParsedRow } from '@/modules/spare-loan-check/types';
