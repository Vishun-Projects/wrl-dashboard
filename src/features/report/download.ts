/** Thin client entry — avoids pulling the full report barrel (and its graph) into exporters. */
export {
  blobToPreparedExport,
  resolveUniqueDownloadFilename,
  triggerBlobDownload,
  type PreparedFileExport,
} from './services/summary-excel-export';
