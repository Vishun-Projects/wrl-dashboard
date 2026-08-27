import path from 'path';
import fs from 'fs';
import { parseSapMblbHtml, SapSupplierGroup } from './sap-parser';
import { fetchCrmSubcontractorStock, fetchCrmVendorPlantMap } from './crm-query';
import { reconcileStock, ReconciledRow, ReconciliationSummary } from './reconciliation-engine';
import { generateReconciliationExcel } from './excel-generator';
import {
  listSubcontractorSkipRules,
  upsertSubcontractorReconciledRun,
  getIstLocalDateStr,
  markSapMailsReconciled,
} from './settings';
import { resolveSubcontractorExtractDir } from './vps-host';

export type RunTodayReconciliationOptions = {
  /** Maildir basenames — only include extracted files prefixed with `{mailKey}_`. */
  mailKeys?: string[];
  dateStr?: string;
};

export type RunReconciliationOptions = {
  filePath: string;
  outputPath?: string;
  skipRules?: Array<{ type: 'PLANT' | 'VENDOR' | 'MATERIAL'; code: string }>;
};

export type ReconciliationResult = {
  rows: ReconciledRow[];
  summary: ReconciliationSummary;
  excelPath?: string;
  plantCodes: string[];
};


/**
 * Executes a single subcontractor stock reconciliation run.
 */
export async function runSubcontractorReconciliation(
  options: RunReconciliationOptions
): Promise<ReconciliationResult> {
  const absoluteFilePath = path.resolve(options.filePath);
  if (!fs.existsSync(absoluteFilePath)) {
    throw new Error(`SAP report file not found at: ${absoluteFilePath}`);
  }

  // 1. Parse SAP HTML Report
  const sapGroups = parseSapMblbHtml(absoluteFilePath);
  
  // 2. Extract Plant Codes
  const plantCodes = Array.from(
    new Set(sapGroups.flatMap(g => g.items.map(item => item.plantCode)))
  );

  if (plantCodes.length === 0) {
    throw new Error('No plant codes could be extracted from the SAP file.');
  }

  // 3. Fetch CRM Stock for the matching plant codes
  const crmRows = await fetchCrmSubcontractorStock(plantCodes);
  const vendorPlantMap = await fetchCrmVendorPlantMap();

  // 4. Perform Variance Analysis with Skip Rules
  const { rows, summary } = reconcileStock(sapGroups, crmRows, vendorPlantMap, options.skipRules);

  // 5. Generate Excel Report if output path is requested
  let excelPath: string | undefined;
  if (options.outputPath) {
    excelPath = path.resolve(options.outputPath);
    const workbook = await generateReconciliationExcel(rows);
    fs.mkdirSync(path.dirname(excelPath), { recursive: true });
    await workbook.xlsx.writeFile(excelPath);
  }

  return {
    rows,
    summary,
    excelPath,
    plantCodes,
  };
}

/**
 * Automatically reconciles today's SAP reports by parsing all files for the latest date.
 */
export async function runTodayReconciliation(
  options: RunTodayReconciliationOptions = {}
): Promise<{ run: any; summary: ReconciliationSummary; rows: ReconciledRow[] }> {
  const searchDir = resolveSubcontractorExtractDir();

  if (!fs.existsSync(searchDir)) {
    throw new Error(`SAP extracted directory not found at: ${searchDir}`);
  }

  const mailKeySet =
    options.mailKeys && options.mailKeys.length > 0
      ? new Set(options.mailKeys.map((k) => k.trim()).filter(Boolean))
      : null;

  // Scan files and extract timestamps
  const files = fs.readdirSync(searchDir);
  const sapFiles: { filename: string; filepath: string; timestamp: number; dateStr: string; mailKey: string | null }[] = [];

  for (const filename of files) {
    if (filename.toLowerCase().endsWith('.htm') || filename.toLowerCase().endsWith('.html')) {
      const filepath = path.join(searchDir, filename);
      const mailKeyMatch = filename.match(/^(.+?)_[^/\\]+\.(htm|html)$/i);
      const mailKey = mailKeyMatch?.[1] ?? null;

      if (mailKeySet && mailKey && !mailKeySet.has(mailKey)) continue;
      if (mailKeySet && !mailKey) continue;

      const match = filename.match(/^(\d+)\./);
      if (match) {
        const timestamp = parseInt(match[1], 10);
        const date = new Date(timestamp * 1000);
        const dateStr = getIstLocalDateStr(date);
        sapFiles.push({ filename, filepath, timestamp, dateStr, mailKey });
      } else {
        const stats = fs.statSync(filepath);
        const dateStr = getIstLocalDateStr(stats.mtime);
        sapFiles.push({ filename, filepath, timestamp: stats.mtimeMs / 1000, dateStr, mailKey });
      }
    }
  }

  const todayDateStr = options.dateStr || getIstLocalDateStr();
  const targetFiles = sapFiles.filter((f) => f.dateStr === todayDateStr);

  if (targetFiles.length === 0) {
    throw new Error(`No HTML files found for today (${todayDateStr}) in: ${searchDir}`);
  }

  const latestDateStr = todayDateStr;
  const combinedGroups: SapSupplierGroup[] = [];

  for (const fileInfo of targetFiles) {
    try {
      const groups = parseSapMblbHtml(fileInfo.filepath);
      combinedGroups.push(...groups);
    } catch (err: any) {
      console.error(`Error parsing file ${fileInfo.filename}:`, err.message);
    }
  }

  if (combinedGroups.length === 0) {
    throw new Error('No stock data could be parsed from any of the target files.');
  }

  const plantCodes = Array.from(
    new Set(combinedGroups.flatMap(g => g.items.map(item => item.plantCode)))
  ).sort();

  // Fetch CRM and Vendor Plant Map
  const crmRows = await fetchCrmSubcontractorStock(plantCodes);
  const vendorPlantMap = await fetchCrmVendorPlantMap();

  // Fetch active Skip Rules
  const skipRules = await listSubcontractorSkipRules();

  // Reconcile
  const { rows, summary } = reconcileStock(combinedGroups, crmRows, vendorPlantMap, skipRules);

  // Generate Excel
  const artifactsDir = path.resolve(process.cwd(), 'artifacts');
  let excelFilename = `reconciliation_report_${latestDateStr}.xlsx`;
  let excelPath = path.resolve(artifactsDir, excelFilename);

  const workbook = await generateReconciliationExcel(rows);
  fs.mkdirSync(artifactsDir, { recursive: true });

  let success = false;
  let attempts = 0;
  while (!success && attempts < 10) {
    try {
      await workbook.xlsx.writeFile(excelPath);
      success = true;
    } catch (writeErr: any) {
      if (writeErr.code === 'EBUSY') {
        attempts++;
        excelFilename = `reconciliation_report_${latestDateStr}_v${attempts}.xlsx`;
        excelPath = path.resolve(artifactsDir, excelFilename);
      } else {
        throw writeErr;
      }
    }
  }

  if (!success) {
    throw new Error('Could not write Excel file after multiple attempts.');
  }

  // Update DB execution record
  const runRecord = await upsertSubcontractorReconciledRun({
    dateStr: latestDateStr,
    summary,
    excelFilename,
  });

  const reconciledMailKeys = [
    ...new Set(
      targetFiles.map((f) => f.mailKey).filter((k): k is string => Boolean(k))
    ),
  ];
  if (reconciledMailKeys.length > 0) {
    await markSapMailsReconciled({ mailKeys: reconciledMailKeys, runDate: latestDateStr });
  }

  return {
    run: runRecord,
    summary,
    rows,
  };
}
