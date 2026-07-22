/** Thin client entry — avoids pulling the full report barrel (and its graph) into exporters. */
export {
  blobToPreparedExport,
  resolveUniqueDownloadFilename,
  triggerBlobDownload,
  type PreparedFileExport,
} from './lib/summary-excel-export';
