import path from 'path';
import fs from 'fs';
import os from 'os';
import { parseSapMblbHtml, SapSupplierGroup } from './sap-parser';
import { fetchCrmSubcontractorStock, fetchCrmVendorPlantMap } from './crm-query';
import { reconcileStock, ReconciledRow, ReconciliationSummary } from './reconciliation-engine';
import { generateReconciliationExcel } from './excel-generator';
import { listSubcontractorSkipRules, upsertSubcontractorReconciledRun, getIstLocalDateStr } from './settings';

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
export async function runTodayReconciliation(): Promise<{ run: any; summary: ReconciliationSummary; rows: ReconciledRow[] }> {
  // Determine input directory (VPS uses /tmp/extracted_sap, local uses extracted_sap)
  const isVPS = os.hostname().startsWith('srv') || fs.existsSync('/home/mis');
  const searchDir = isVPS ? '/tmp/extracted_sap' : path.resolve(process.cwd(), 'extracted_sap');

  if (!fs.existsSync(searchDir)) {
    throw new Error(`SAP extracted directory not found at: ${searchDir}`);
  }

  // Scan files and extract timestamps
  const files = fs.readdirSync(searchDir);
  const sapFiles: { filename: string; filepath: string; timestamp: number; dateStr: string }[] = [];

  for (const filename of files) {
    if (filename.toLowerCase().endsWith('.htm') || filename.toLowerCase().endsWith('.html')) {
      const filepath = path.join(searchDir, filename);
      const match = filename.match(/^(\d+)\./);
      if (match) {
        const timestamp = parseInt(match[1], 10);
        const date = new Date(timestamp * 1000);
        const dateStr = getIstLocalDateStr(date);
        sapFiles.push({ filename, filepath, timestamp, dateStr });
      } else {
        const stats = fs.statSync(filepath);
        const dateStr = getIstLocalDateStr(stats.mtime);
        sapFiles.push({ filename, filepath, timestamp: stats.mtimeMs / 1000, dateStr });
      }
    }
  }

  const todayDateStr = getIstLocalDateStr();
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

  return {
    run: runRecord,
    summary,
    rows,
  };
}
