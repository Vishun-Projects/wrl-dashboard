# WRL Portal

Internal web portal for **Western Refrigeration Pvt. Ltd.** to view service-call reports, run audits, and manage portal access.

Sign in with your assigned email and password. After login you land on your usual report page (or the first page your role allows).

---

## What you can do

### Reports

| Page | Purpose |
|------|---------|
| **MIS Reports** | Search and browse the call register — summary counts, detailed rows, accounts view. Filter by date, branch, franchisee, call type, and status. Export to CSV or Excel. Click a TRN to open call details in a dialog. |
| **Call Distribution** | See how calls are spread across branches and franchisees — map view, idle assignees, and distribution KPIs. |
| **ARCP Claims** | Review ARCP claims in a register view with detail export. |
| **Serial Wise History** | Find serial numbers with repeat complaints. Expand a row to see call history, repeat flags, and repair context in the selected date range. |
| **Location Audit** | Check whether technician visit locations match customer install addresses — pincode and GPS comparison with flagged mismatches. |

Report filters and column choices are remembered per user. A small banner can show when your last saved view was restored.

### Administration

| Page | Purpose |
|------|---------|
| **User Management** | Create and edit portal users (admins). |
| **Roles & Access** | Define roles and choose which report pages each role can open. |

### Profile

Update your name, avatar, and password. Reset saved report defaults if you want filters back to the role baseline.

---

## Access

- Each user has a **role** (for example branch manager or HOD) and optional **office scope**.
- **Page access** is controlled per role — you only see menu items and routes you are allowed to use.
- Admins manage users and roles from the Administration section.

---

## For developers

This app is built with **Next.js** and **Supabase** (authentication and app user profiles).

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Production build:

```bash
npm run build
npm start
```

Environment variables and database setup for portal users are documented in [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md). Additional internal docs live under `docs/` for the team maintaining the project.

---

## Project name

The repository folder is `fast-close-app`; the product name shown in the UI is **WRL Portal** (also referred to as WRL Dashboard on the login screen).
