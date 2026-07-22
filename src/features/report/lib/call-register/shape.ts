export type CallRegisterSerialExportRow = {
  client: string;
  serial: string;
  qtyDate: string;
  installationDate: string;
  deploymentDate: string;
  pendingInstall: 'Yes' | 'No';
  pendingDeploy: 'Yes' | 'No';
};

export function formatSerialExportDate(value: unknown): string {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  // CRM daddedon: dd/mm/yyyy hh:mm:ss
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

/** Pure row shaping for Excel export rows. */
export function shapeSerialExportRow(input: {
  client: string;
  serial: string;
  qtyDate: unknown;
  installationDate: unknown;
  deploymentDate: unknown;
}): CallRegisterSerialExportRow {
  const installationDate = formatSerialExportDate(input.installationDate);
  const deploymentDate = formatSerialExportDate(input.deploymentDate);
  return {
    client: input.client,
    serial: input.serial,
    qtyDate: formatSerialExportDate(input.qtyDate),
    installationDate,
    deploymentDate,
    pendingInstall: installationDate ? 'No' : 'Yes',
    pendingDeploy: deploymentDate ? 'No' : 'Yes',
  };
}
