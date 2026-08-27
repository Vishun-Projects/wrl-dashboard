import fs from 'fs';
import os from 'os';
import path from 'path';

/** True when SAP Maildir / extracted_sap live on this host (VPS). */
export function isSubcontractorVpsHost(): boolean {
  return os.hostname().startsWith('srv') || fs.existsSync('/home/mis');
}

export function resolveSubcontractorExtractDir(): string {
  return isSubcontractorVpsHost()
    ? '/tmp/extracted_sap'
    : path.resolve(process.cwd(), 'extracted_sap');
}
