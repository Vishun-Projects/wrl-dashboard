import { hasCapability } from '@/lib/auth/rbac-catalog';

export const MIS_CLIENT_IMPORT_UPLOAD_PERMISSION = 'mis_client_import_upload';
export const MIS_CLIENT_IMPORT_DELETE_PERMISSION = 'mis_client_import_delete';

export function canUploadClientMis(permissions: string[]): boolean {
  return hasCapability(permissions, MIS_CLIENT_IMPORT_UPLOAD_PERMISSION);
}

export function canDeleteClientMis(permissions: string[]): boolean {
  return hasCapability(permissions, MIS_CLIENT_IMPORT_DELETE_PERMISSION);
}
