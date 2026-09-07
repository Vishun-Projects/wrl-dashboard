# WRL Portal — Company delivery guide

> Send from this folder (PDF/Word), not raw markdown.

## Document status

| Status | Meaning |
|--------|---------|
| **Ready** | Safe to share — content from production/codebase |
| **Needs SSH sign-off** | Ops checklist requires verification on VPS host |
| **Sign-off blank** | Delivery statement awaiting Sunil / VP reply |

## What to send whom

| Recipient | Files | Status |
|-----------|-------|--------|
| **Sunil / VP (sign-off)** | `PDF/00_Closure_Summary.pdf`, `PDF/01_BRD_WRL_Portal.pdf`, `PDF/06_Delivery_Statement.pdf` | Ready |
| **Sunil / business** | `Word/01_Scope_Summary.docx`, `PDF/02_Admin_User_Guide.pdf` | Ready |
| **MIS / branch managers** | `PDF/02_Admin_User_Guide.pdf` | Ready (text guide) |
| **IT / ops (Vishnu)** | `PDF/03_Architecture_Diagrams.pdf`, `PDF/03_API_Reference.pdf`, `PDF/05_*.pdf` | Ready |
| **Roles / portal admin (Vishnu)** | `Excel/RBAC_MATRIX.xlsx`, `PDF/04_Roles_Snapshot.pdf` | Ready (live DB) |
| **VPS checklist** | `Word/05_VPS_Env_Checklist.docx` | SSH on host (Vishnu) |

## Regenerate

`npm run handover:export`
