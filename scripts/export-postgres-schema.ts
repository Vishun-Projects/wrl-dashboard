#!/usr/bin/env npx tsx
/**
 * Export Postgres table schemas to Excel.
 * Usage: npx tsx scripts/export-postgres-schema.ts [output.xlsx]
 */
import '@/lib/read-model/bootstrap-env';
import ExcelJS from 'exceljs';
import { Client } from 'pg';
import { closePool } from '@/lib/read-model/db';

type ColumnRow = {
  table_name: string;
  ordinal_position: number;
  column_name: string;
  data_type: string;
  udt_name: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
  identity_generation: string | null;
};

type ConstraintRow = {
  table_name: string;
  constraint_name: string;
  constraint_type: string;
  column_name: string;
};

function formatDataType(col: ColumnRow): string {
  const base = col.data_type === 'USER-DEFINED' ? col.udt_name : col.data_type;
  if (col.character_maximum_length != null) {
    return `${base}(${col.character_maximum_length})`;
  }
  if (col.numeric_precision != null) {
    return col.numeric_scale != null
      ? `${base}(${col.numeric_precision},${col.numeric_scale})`
      : `${base}(${col.numeric_precision})`;
  }
  return base;
}

function columnKeys(constraints: ConstraintRow[], table: string, column: string): string {
  const parts: string[] = [];
  for (const c of constraints) {
    if (c.table_name !== table || c.column_name !== column) continue;
    if (c.constraint_type === 'PRIMARY KEY') parts.push('PK');
    else if (c.constraint_type === 'FOREIGN KEY') parts.push(`FK (${c.constraint_name})`);
    else if (c.constraint_type === 'UNIQUE') parts.push('UNIQUE');
  }
  return parts.join(', ');
}

function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });
  row.height = 22;
}

function safeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/*?:[\]]/g, '_').slice(0, 31);
  return cleaned || 'table';
}

async function main(): Promise<void> {
  const outFile =
    process.argv[2] ?? `WRL_Postgres_Schema_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const schema = process.env.SCHEMA_EXPORT_SCHEMA?.trim() || 'public';

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const tablesRes = await client.query<{ table_name: string; table_comment: string | null }>(
      `
      SELECT t.table_name,
             obj_description((quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass, 'pg_class') AS table_comment
      FROM information_schema.tables t
      WHERE t.table_schema = $1 AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name
      `,
      [schema]
    );

    const columnsRes = await client.query<ColumnRow>(
      `
      SELECT table_name, ordinal_position, column_name, data_type, udt_name,
             character_maximum_length, numeric_precision, numeric_scale,
             is_nullable, column_default, is_identity, identity_generation
      FROM information_schema.columns
      WHERE table_schema = $1
      ORDER BY table_name, ordinal_position
      `,
      [schema]
    );

    const constraintsRes = await client.query<ConstraintRow>(
      `
      SELECT tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = $1
      ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position
      `,
      [schema]
    );

    const indexesRes = await client.query<{
      tablename: string;
      indexname: string;
      indexdef: string;
    }>(
      `
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = $1
      ORDER BY tablename, indexname
      `,
      [schema]
    );

    const columnsByTable = new Map<string, ColumnRow[]>();
    for (const col of columnsRes.rows) {
      const list = columnsByTable.get(col.table_name) ?? [];
      list.push(col);
      columnsByTable.set(col.table_name, list);
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'fast-close-app';
    workbook.created = new Date();

    const overview = workbook.addWorksheet('Tables Overview');
    overview.columns = [
      { header: '#', key: 'num', width: 6 },
      { header: 'Table Name', key: 'table', width: 32 },
      { header: 'Columns', key: 'cols', width: 10 },
      { header: 'Comment', key: 'comment', width: 40 },
    ];
    styleHeader(overview.getRow(1));

    let tableNum = 0;
    for (const t of tablesRes.rows) {
      tableNum += 1;
      const cols = columnsByTable.get(t.table_name) ?? [];
      overview.addRow({
        num: tableNum,
        table: t.table_name,
        cols: cols.length,
        comment: t.table_comment ?? '',
      });

      const sheet = workbook.addWorksheet(safeSheetName(t.table_name));
      sheet.columns = [
        { header: '#', key: 'num', width: 6 },
        { header: 'Column Name', key: 'name', width: 28 },
        { header: 'Data Type', key: 'type', width: 22 },
        { header: 'Nullable', key: 'nullable', width: 10 },
        { header: 'Default', key: 'default', width: 36 },
        { header: 'Identity', key: 'identity', width: 14 },
        { header: 'Keys', key: 'keys', width: 28 },
      ];
      styleHeader(sheet.getRow(1));

      sheet.mergeCells('A2:G2');
      const title = sheet.getCell('A2');
      title.value = `Table: ${schema}.${t.table_name}`;
      title.font = { bold: true, size: 12 };
      title.alignment = { horizontal: 'left' };

      let rowNum = 0;
      for (const col of cols) {
        rowNum += 1;
        const identity =
          col.is_identity === 'YES'
            ? col.identity_generation ?? 'YES'
            : '';
        sheet.addRow({
          num: rowNum,
          name: col.column_name,
          type: formatDataType(col),
          nullable: col.is_nullable === 'YES' ? 'Yes' : 'No',
          default: col.column_default ?? '',
          identity,
          keys: columnKeys(constraintsRes.rows, t.table_name, col.column_name),
        });
      }

      const tableIndexes = indexesRes.rows.filter((i) => i.tablename === t.table_name);
      if (tableIndexes.length > 0) {
        sheet.addRow({});
        const idxHeader = sheet.addRow({ name: 'Indexes' });
        idxHeader.font = { bold: true };
        for (const idx of tableIndexes) {
          sheet.addRow({ name: idx.indexname, type: idx.indexdef });
        }
      }

      sheet.views = [{ state: 'frozen', ySplit: 3 }];
    }

    const allCols = workbook.addWorksheet('All Columns');
    allCols.columns = [
      { header: 'Table', key: 'table', width: 28 },
      { header: '#', key: 'num', width: 6 },
      { header: 'Column Name', key: 'name', width: 28 },
      { header: 'Data Type', key: 'type', width: 22 },
      { header: 'Nullable', key: 'nullable', width: 10 },
      { header: 'Default', key: 'default', width: 36 },
      { header: 'Keys', key: 'keys', width: 28 },
    ];
    styleHeader(allCols.getRow(1));
    for (const t of tablesRes.rows) {
      const cols = columnsByTable.get(t.table_name) ?? [];
      for (const col of cols) {
        allCols.addRow({
          table: t.table_name,
          num: col.ordinal_position,
          name: col.column_name,
          type: formatDataType(col),
          nullable: col.is_nullable === 'YES' ? 'Yes' : 'No',
          default: col.column_default ?? '',
          keys: columnKeys(constraintsRes.rows, t.table_name, col.column_name),
        });
      }
    }
    allCols.views = [{ state: 'frozen', ySplit: 1 }];

    await workbook.xlsx.writeFile(outFile);
    console.log(`Schema exported: ${outFile}`);
    console.log(`Schema: ${schema} | Tables: ${tablesRes.rows.length}`);
  } finally {
    await client.end();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
