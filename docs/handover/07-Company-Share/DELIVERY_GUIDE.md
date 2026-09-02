# WRL Portal — Company delivery guide

> Send from this folder (PDF/Word), not raw markdown.

## Document status

| Status | Meaning |
|--------|---------|
| **Ready** | Safe to share — content from production/codebase |
| **Needs SSH sign-off** | Ops checklist requires verification on VPS host |
| **Sign-off blank** | Delivery statement awaiting VP reply |

## What to send whom

| Recipient | Files | Status |
|-----------|-------|--------|
| **VP / Rakesh** | `PDF/00_Closure_Summary.pdf`, `PDF/01_BRD_WRL_Portal.pdf`, `PDF/06_Delivery_Statement.pdf` | Ready |
| **Sunil / business** | `Word/01_Scope_Summary.docx`, `PDF/02_Admin_User_Guide.pdf` | Ready |
| **MIS / branch managers** | `PDF/02_Admin_User_Guide.pdf` | Ready (text guide) |
| **IT** | `PDF/03_Architecture_Diagrams.pdf`, `PDF/03_API_Reference.pdf` | Ready |
| **Roles / IT** | `Excel/RBAC_MATRIX.xlsx`, `PDF/04_Roles_Snapshot.pdf` | Ready (live DB) |
| **Ops** | `PDF/05_*.pdf`, `Word/05_VPS_Env_Checklist.docx` | Checklist needs SSH |

## Regenerate

`npm run handover:export`
