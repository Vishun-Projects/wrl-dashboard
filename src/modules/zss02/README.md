# ZSS02

Browse SAP **ZSS02** spare-parts HTML exports as-is (Plant / Vendor / Material / Barcode / SO / dates).

- **Page:** `/report/zss02`
- **API:** `/api/report/zss02`
- **Permission:** `page_zss02` (also granted via `page_mis_reports` / register tab until roles are updated)

## Behaviour

1. Upload one or more `.htm` / `.html` ZSS02 files (browser gzips before POST).
2. Each file becomes a `zss02_imports` batch with rows in `zss02_rows`.
3. Re-upload **overwrites** existing rows for every plant in the file (no append / no duplicates).
4. Header shows **Details as on DD-MM-YYYY** from the latest Loan Date in stored rows.
5. Filters use **Apply filters** (draft until applied). Plant filter labels use CRM branch names.
6. Status column (before Plant): cancelled (Ban) / franchisee change (warning) via the same CRM match rules as Spare Loan Check.
7. Out-of-scope plants (non-HOD office restriction) are skipped and counted in `skipped`.

Parser / CRM classify helpers are shared with Spare Loan Check. That page still only stores problem rows; this page stores the full ledger.

## Schema

Apply chunk `docs/read-model-phase1-schema/55-zss02.sql` (via the usual read-model schema apply script).

## Check

```bash
npx tsx src/modules/zss02/server/store.check.ts
```
