import { formatExportDate } from '@/lib/utils/export-dates';
import { escapeCsvCell } from '@/lib/utils/csv';
import type { LocationAuditDetailRow } from '@/features/location-audit/lib/types';



function formatAuditStatus(status: string): string {
  if (status === 'mismatch') return 'Pincode mismatch';
  if (status === 'no_gps') return 'No stored GPS';
  if (status === 'no_address') return 'No address';
  if (status === 'ok') return 'OK';
  return status;
}

function formatSeverity(severity: string): string {
  if (severity === 'flag') return 'Flag';
  if (severity === 'review') return 'Review';
  if (severity === 'incomplete') return 'Incomplete';
  return 'OK';
}

export function exportLocationAuditCsv(rows: LocationAuditDetailRow[]): string {
  const headers = [
    'Call No (TRN)',
    'Call ID',
    'Office ID',
    'CCL ID',
    'Call Date',
    'Severity',
    'Branch',
    'Party Name',
    'Install Pincode',
    'Pincode at GPS',
    'GPS to install area (km)',
    'Distance stored to install (km)',
    'Visit distance to install (km)',
    'Visit distance to stored (m)',
    'Expected install lat',
    'Expected install lng',
    'Stored GPS lat',
    'Stored GPS lng',
    'Visit GPS lat',
    'Visit GPS lng',
    'Audit Result',
    'Detail',
  ];

  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.vtrnno,
        r.ncode,
        r.officeId,
        r.vcclid,
        formatExportDate(r.callDate),
        formatSeverity(r.severity),
        r.branchName,
        r.partyName,
        r.pincode,
        r.storedGpsPincode,
        r.gpsToInstallAreaKm,
        r.distanceToInstallM != null ? (r.distanceToInstallM / 1000).toFixed(2) : '',
        r.distanceVisitToInstallM != null ? (r.distanceVisitToInstallM / 1000).toFixed(2) : '',
        r.distanceVisitToStoredM,
        r.expectedInstallLat,
        r.expectedInstallLng,
        r.crmLat,
        r.crmLng,
        r.visitLat,
        r.visitLng,
        formatAuditStatus(r.status),
        r.mismatchExplanation,
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  return '\uFEFF' + lines.join('\n');
}
