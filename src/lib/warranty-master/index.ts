/**
 * Warranty Master — client-safe exports (types, filtering, sort, CSV).
 * Server CRM fetch: `@/lib/warranty-master/server`
 */

export type {
  WarrantyMasterAggregateRow,
  WarrantyMasterClientFilters,
  WarrantyMasterDimOption,
  WarrantyMasterDims,
  WarrantyMasterFgDetailRow,
  WarrantyMasterFgLineRow,
  WarrantyMasterQueryParams,
  WarrantyMasterRowDetailParams,
  WarrantyMasterSummary,
} from './types';

export {
  aggregateWarrantyMasterFgLines,
  aggregateRowKey,
  buildWarrantyMasterDimsFromFgLines,
  buildWarrantyMasterFgDetailIndex,
  fgDetailRowsForAggregate,
  fgDetailRowsForAggregateFromIndex,
  filterWarrantyMasterFgLines,
  summarizeWarrantyMasterRows,
  type WarrantyMasterFgDetailIndex,
} from './filter';

export {
  sortWarrantyMasterAggregateRows,
  sortWarrantyMasterFgDetailRows,
  sortWarrantyMonthValues,
} from './sort';

export { exportWarrantyMasterCsv } from './export-csv';

export {
  parseWarrantyMasterDetailParams,
  parseWarrantyMasterParams,
  warrantyMasterParamsToSearchParams,
} from './params';
