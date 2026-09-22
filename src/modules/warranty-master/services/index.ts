/**
 * Warranty Master — client-safe exports (types, filtering, sort, CSV).
 * Server CRM fetch: `@/modules/warranty-master/server`
 */

export type {
  WarrantyMasterAggregateRow,
  WarrantyMasterClientFilters,
  WarrantyMasterFgDetailRow,
  WarrantyMasterFgLineRow,
  WarrantyMasterSerialRow,
  WarrantyMasterExportRow,
  WarrantyMasterSummary,
  WarrantyMasterHierarchyGroup,
  WarrantyMasterHierarchySubgroup,
  WarrantyMasterHierarchyWarranty,
} from './types';

export {
  normalizeAggregateRows,
  normalizeFgDetailRows,
  normalizeFgLineRows,
  normalizeSerialRows,
} from './normalize';

export {
  aggregateWarrantyMasterFgLines,
  buildWarrantyMasterHierarchy,
  normalizeWarrantyMasterFgLinesForUi,
  normalizedTextKey,
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

export { exportWarrantyMasterCsv, exportWarrantyMasterDetailedCsv, exportWarrantyMasterSerialsCsv } from './export-csv';

export {
  parseWarrantyMasterDetailParams,
  parseWarrantyMasterParams,
  warrantyMasterParamsToSearchParams,
} from './params';
