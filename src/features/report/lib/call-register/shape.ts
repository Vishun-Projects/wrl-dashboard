import { formatUiDate } from '@/lib/dates/ui-date';

export type CallRegisterSerialExportRow = {
  client: string;
  serial: string;
  /** CRM WarrantyStartDate — billing date shown in UI. */
  qtyDate: string;
  /** CRM daddedon — import/upload date; date-range filter uses this. */
  importedDate: string;
  installationDate: string;
  deploymentDate: string;
  pendingInstall: 'Yes' | 'No';
  pendingDeploy: 'Yes' | 'No';
};

/** Call Register serial dates shown in UI / Excel — dd/mm/yyyy. */
export function formatSerialExportDate(value: unknown): string {
  return formatUiDate(value);
}

/** Pure row shaping for Excel export rows. */
export function shapeSerialExportRow(input: {
  client: string;
  serial: string;
  qtyDate: unknown;
  importedDate?: unknown;
  installationDate: unknown;
  deploymentDate: unknown;
}): CallRegisterSerialExportRow {
  const installationDate = formatSerialExportDate(input.installationDate);
  const deploymentDate = formatSerialExportDate(input.deploymentDate);
  return {
    client: input.client,
    serial: input.serial,
    qtyDate: formatSerialExportDate(input.qtyDate),
    importedDate: formatSerialExportDate(input.importedDate),
    installationDate,
    deploymentDate,
    pendingInstall: installationDate ? 'No' : 'Yes',
    pendingDeploy: deploymentDate ? 'No' : 'Yes',
  };
}
