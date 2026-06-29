/** Max MIS client file upload (CSV / Excel). Multipart bodies need headroom in proxy config. */
export const MIS_CLIENT_MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

export const MIS_CLIENT_MAX_UPLOAD_LABEL = '300 MB';

export function formatMisUploadTooLargeMessage(fileBytes: number): string {
  const mb = (fileBytes / (1024 * 1024)).toFixed(1);
  return `File is ${mb} MB. Maximum upload size is ${MIS_CLIENT_MAX_UPLOAD_LABEL}.`;
}
