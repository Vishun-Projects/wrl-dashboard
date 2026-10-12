# MB51 Material Aging Report (FIFO)

MB51 SAP export material aging analysis with FIFO stock-to-receipt layer calculation.

- **Page:** `/report/mb51-aging`
- **API:** `/api/report/mb51-aging`
- **Permission:** `page_mb51_aging` (accessible via `page_mis_reports` / register tab)

## Features

1. Drag-and-drop or file upload for `.xlsx`, `.xlsm`, `.xls`, `.csv` MB51 export files.
2. Multi-sheet workbook selection.
3. Automatically stores parsed movement records into PostgreSQL (`mb51_aging_imports` & `mb51_aging_rows`).
4. Remembers and displays the latest database-saved records automatically upon page visit.
5. Aging basis date & receipt date range filters.
6. Multi-select searchable dropdowns for Vendor, Material Group, Material, and Plant.
7. Grouping by Material, Vendor, Material Group, or Vendor + Material.
8. 7 aging bucket KPI cards with visual breakdown bars.
9. Interactive sorting and search filtering in the results table.
10. Excel (.xlsx) export with totals and column formatting matching the original specification.
