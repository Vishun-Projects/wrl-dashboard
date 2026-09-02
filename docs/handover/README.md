# WRLD handover pack

Stakeholder-ready documentation for **WRL Portal** delivery. Canonical copies live here (versioned) and are mirrored to OneDrive when you run the export script.

## Folder layout

| Folder | Contents |
|--------|----------|
| `00-Index/` | Master index and one-page closure summary |
| `01-Business/` | BRD and scope summary |
| `02-Functional/` | Functional module spec (FMS) and admin user guide |
| `03-Technical/` | Architecture, API reference (generated), git/release, diagrams |
| `04-RBAC/` | Permission matrix (xlsx/csv), roles snapshot, decision-flow notes |
| `05-Operations/` | Prod read source, mail schedule, sync entry points, known issues, VPS checklist |
| `06-Delivery/` | System verification + delivery statement (generated from DB/code) |
| `07-Company-Share/` | **Company delivery** — PDF, Word (.docx), diagram PNGs, Excel, zip |

## What to share with the company

**Do not email raw `.md` files.** Use `07-Company-Share/`:

| Folder | Use |
|--------|-----|
| `PDF/` | Email attachments, formal archive (VP, IT, ops) |
| `Word/` | Editable docs (scope, BRD, delivery statement) |
| `Excel/` | Live RBAC matrix (from `DATABASE_URL`) |
| `Diagrams/` | Architecture PNGs for slides / Confluence |
| `WRL_Portal_Handover_CompanyShare.zip` | One upload to SharePoint / OneDrive |

Open `07-Company-Share/DELIVERY_GUIDE.md` (or `PDF/00_Delivery_Guide.pdf`) for who gets which file.

Each PDF has: **cover page** (org, product, date), **header/footer** (confidential + page numbers), and **consistent typography**. The diagrams PDF uses **one diagram per page** with smart scaling for wide/tall images.

## Document consistency (how it works)

| Layer | Purpose |
|-------|---------|
| `scripts/ops/handover-document-template.mjs` | Cover page, headers, footers, diagram layout classes |
| `scripts/ops/handover-pdf.css` | Print typography, tables, page breaks, diagram frames |
| `07-Company-Share/PDF/` | Final read-only output for stakeholders |
| `07-Company-Share/Word/` | Editable output (business docs) |
| Source `.md` in `00-Index`…`06-Delivery` | Developer-editable; regen overwrites PDF/Word |

**Industry practice:** PDF for archive/sign-off, Word for editable business docs, Excel for live RBAC export. Markdown is source-only — never email `.md` to the company.

**Export requires `DATABASE_URL`** in `.env.local` — RBAC matrix and delivery docs use live production data.

## Regenerate

From the repo root:

```bash
npm run handover:export
```

This always writes `docs/handover/` (including `07-Company-Share/`) and also copies to:

`C:\Users\Vishnu.Vishwakarma\OneDrive\Documents\WRLD`

Override the OneDrive destination:

```bash
HANDOVER_OUT=/path/to/WRLD npm run handover:export
```

## What is generated vs authored

| Generated on each export | Authored in repo (edit these) |
|--------------------------|-------------------------------|
| `03-Technical/API_REFERENCE.md` | `01-Business/*`, `02-Functional/*`, `00-Index/*` |
| `03-Technical/GIT_AND_RELEASE.md` | `05-Operations/KNOWN_ISSUES_AND_LIMITATIONS.md` |
| `04-RBAC/RBAC_MATRIX.xlsx` / `.csv` / `ROLES_SNAPSHOT.md` | `05-Operations/VPS_ENV_VERIFICATION_CHECKLIST.md` |
| `06-Delivery/SYSTEM_VERIFICATION.md` / `DELIVERY_STATEMENT.md` | |
| Copies of `docs/ARCHITECTURE.md`, diagrams, ops docs | |
| `07-Company-Share/PDF/*.pdf`, `Word/*.docx`, `Diagrams/*.png`, zip | All markdown docs above |

**Word output** uses [Pandoc](https://pandoc.org/) 3.x with `scripts/ops/handover-reference.docx` (customise styles in Word, save back to that file). Override binary: `PANDOC_PATH=/path/to/pandoc`.

Start at [`00-Index/DOCUMENT_INDEX.md`](00-Index/DOCUMENT_INDEX.md). **For company email:** [`07-Company-Share/DELIVERY_GUIDE.md`](07-Company-Share/DELIVERY_GUIDE.md).
