# Admin and user guide — WRL Portal

> **Status:** Ready (text guide — no screenshots). Paths and behaviour match production at https://wrl-dashboard.vercel.app.

Non-technical walkthrough for portal users.

---

## 1. Signing in

1. Open **https://wrl-dashboard.vercel.app**
2. Enter your assigned email and password.
3. After login you land on your **default page** for your role — typically the first report you can access (often MIS Reports at `/report`).

---

## 2. Layout and navigation

The portal uses a **left sidebar** plus a **main content area** with a page title bar at the top. There is no top navigation bar on desktop.

### Desktop

1. **Sidebar (left)** — collapsible via the chevron on the sidebar edge; collapse state is saved in browser storage.
2. **WRL PORTAL logo** (top of sidebar) — click returns you to your **default landing page** (first report your role can access, usually `/report`).
3. **Report links** — listed directly in the sidebar (only pages your role grants).
4. **Admin** — if you have admin pages, they appear under an **Admin** accordion (expand/collapse). When the sidebar is collapsed, Admin opens as a **popover** from the shield icon. Includes **Activity Log** (`/admin/security-audit`) for Super Admin only.
5. **Profile (bottom of sidebar)** — click your name/avatar to open a menu:
   - **My Profile** → `/profile`
   - **Settings** → `/profile?tab=settings` (password)
   - **Sign Out**

### Mobile

- A **top bar** shows the logo and a **hamburger menu** that opens the same sidebar as a drawer.

If you need a page you do not see, contact your portal administrator.

### Sidebar vs direct URL

Some admin routes exist but are **not listed in the sidebar**. Admins with permission can still open them by URL:

| Page | Path | In sidebar |
|------|------|:----------:|
| Read-model sync | `/admin/sync` | No |
| Service call activity | `/admin/attendance` | No |
| VPS Cron | `/admin/vps-cron` | No (super admin) |

Legacy mail sub-routes (`/admin/mis-email-routing`, etc.) redirect to **Mail & Alerts** hub — use `/admin/mis-email-settings`.

### Navigation reference (RBAC catalog)

| Menu label | Path | Group | Sidebar |
|------------|------|-------|:-------:|
| MIS Reports | `/report` | Reports | Yes |
| Call Distribution | `/report/distribution` | Reports | Yes |
| ARCP Claims | `/report/arcp-claims` | Reports | Yes |
| Serial Wise History | `/report/serial-audit` | Reports | Yes |
| Location Audit | `/report/location-audit` | Reports | Yes |
| Warranty Master | `/report/warranty-master` | Reports | Yes |
| Failed Calls - Athena API | `/report/athena-reconciliation` | Reports | Yes |
| Cancelled Calls | `/report/cancelled-calls` | Reports | Yes |
| User Management | `/admin/users` | Administration | Yes |
| Roles & Access | `/admin/roles` | Administration | Yes |
| Mail & Alerts | `/admin/mis-email-settings` | Administration | Yes |
| Performance Insights | `/admin/performance-insights` | Administration | Yes |
| Read-model sync | `/admin/sync` | Administration | No |
| Service call activity | `/admin/attendance` | Administration | No |
| Activity Log | `/admin/security-audit` | Administration | Yes (under Admin; super admin only) |

You only see menu items your role is granted. Full matrix: [`04-RBAC/RBAC_MATRIX.xlsx`](../04-RBAC/RBAC_MATRIX.xlsx).

---

## 3. MIS Reports (`/report`)

The main MIS hub has tabs (you may not see all tabs):

| Tab | Permission | What it shows |
|-----|------------|---------------|
| **Summary Dashboard** | `tab_mis_summary` | Counts by status, aging buckets |
| **Call Register** | `tab_mis_register` | Row-level calls; click **TRN** for detail drawer |
| **Key Account MIS** | `tab_mis_accounts` | Account-level rollup |
| **Client Import** | `tab_mis_client_import` | Upload/delete client MIS files (capability also required) |
| **Cadbury+Coke+CRM Summary** | `tab_mis_bd_mis_summary` | BD-MIS with client import merge |
| **Deployment Completion** | `tab_mis_deployment_completion` | Deployment metrics |

**Common tasks:**

1. Set **date range** and **branch** (or franchisee) filters at the top.
2. Click **Apply** or wait for auto-refresh.
3. Use **Export** for Excel/CSV where available.
4. On first load, filters start from your **role baseline** (assigned branches). Use **Clear all** on Call Register to reset filters on that tab.

### Call detail drawer

Click a **TRN** in Call Register to open live call details from CRM (comments, history, flags if permitted).

---

## 4. Other reports

Each report has its own menu item with filters suited to that audit:

| Menu item | Path | Use for |
|-----------|------|---------|
| **Call Distribution** | `/report/distribution` | How calls spread across branches/franchisees |
| **ARCP Claims** | `/report/arcp-claims` | Claims register |
| **Serial Wise History** | `/report/serial-audit` | Repeat serial complaints |
| **Location Audit** | `/report/location-audit` | Visit location vs install address |
| **Warranty Master** | `/report/warranty-master` | Active machines and warranty |
| **Cancelled Calls** | `/report/cancelled-calls` | Cancelled register and export |
| **Failed Calls (Athena API)** | `/report/athena-reconciliation` | CRM ingestion failures |

Open the page → set filters → browse or export. Behaviour matches the on-screen labels.

---

## 5. Administration

Available only to admin roles.

### User Management (`/admin/users`)

- Create users with email, name, role, and office scope.
- Enable **MIS email** for users who should receive digests (also needs role capability).

### Roles & Access (`/admin/roles`)

- Edit which pages and MIS tabs each role can open.
- Use the hierarchical editor for MIS tabs.

### Mail & Alerts (`/admin/mis-email-settings`)

Single hub at `/admin/mis-email-settings` with tabs:

- **Org settings** — outbound mail enabled, allowed domains
- **MIS Email Routing** — scheduled routing rules and recipients
- **Major Repair Alerts** — branch/HQ recipients
- **Cancelled Calls** — daily digest recipients
- **VPS Cron & schedules** — super admin only; pause/resume VPS mail jobs
- **Subcontractor Stock** — SAP reconcile settings (ops)

Legacy URLs (`/admin/mis-email-routing`, `/admin/major-repair-alerts`, `/admin/cancelled-call-alerts`, `/admin/vps-cron`) redirect into this hub.

Access: `page_mis_email_settings` **or** `manage_users` / `manage_roles` / `view_all_offices` (OR-gate in RBAC catalog).

| Page | Path | Notes |
|------|------|-------|
| Read-model sync | `/admin/sync` | Status and refresh only (`manage_users`) |
| Service call activity | `/admin/attendance` | Technician activity export (`manage_users`) |
| Performance Insights | `/admin/performance-insights` | Sidebar link (`page_performance_insights`) |

**Super admin only:** On MIS Reports → **Call Register** tab, button **CRM sync → yesterday** triggers VPS hot sync (not on `/admin/sync`).

---

## 6. Access by role

Production role configuration (who has which pages/tabs) is exported from the database:

- [`04-RBAC/ROLES_SNAPSHOT.md`](../04-RBAC/ROLES_SNAPSHOT.md) — permissions per role
- [`04-RBAC/RBAC_MATRIX.xlsx`](../04-RBAC/RBAC_MATRIX.xlsx) — full grid

**Configured roles in production:** BM - Serial Audit, Branch Manager, HOD, Mail access, Super Admin, View Summary. User counts change over time — see ROLES_SNAPSHOT for current numbers.

---

## 7. Profile (`/profile`)

Open from the sidebar footer menu → **My Profile**, or go to `/profile`.

| Tab | What you can do |
|-----|-----------------|
| **General** | Display name, profile photo |
| **Appearance** | Theme (light/dark) |
| **Email reports** | MIS digest preferences (only if your role has MIS email capability) |
| **Security** | Change password |

Branch and report access are managed by an administrator — not from Profile.

---

## 8. Common tasks

| Task | Steps |
|------|-------|
| Export register | MIS Reports → Call Register → Export |
| Request new page access | Email portal admin with your email and required report |
| Reset stuck filters | MIS Reports → Call Register → **Clear all** (other reports may use **Reset filters** on their toolbar) |
| Report wrong count | Note date range, branch, tab; contact admin with TRN if applicable |

---

## 9. Tips

- Data in reports may be up to **~3 minutes** behind CRM; the call drawer is live.
- Excel digests use the same Cadbury-safe rules as email — counts may differ slightly from BD-MIS West zone on screen (see FMS).
- Do not share your login; each user should have their own account for audit purposes.

---

## 10. System verification

Portal facts (user counts, API routes, export date): [`06-Delivery/SYSTEM_VERIFICATION.md`](../06-Delivery/SYSTEM_VERIFICATION.md).

---

## Related documents

- [`FMS_Functional_Module_Spec.md`](FMS_Functional_Module_Spec.md) — detailed module reference
- [`BRD_WRL_Portal.md`](../01-Business/BRD_WRL_Portal.md) — business context
