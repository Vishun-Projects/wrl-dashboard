# `src/components` layout

Cross-page chrome and UI kit only. Domain UI lives under `src/features/<domain>/components/`.

| Path | Purpose |
|------|---------|
| `layout/` | `DashboardLayout`, `Sidebar`, `PageShell`, `PageAccessGuard` |
| `ui/` | Shared primitives (Button, PageAlert, ConfirmDialog, …) |
| `calls/` | Call detail dialog, `TrnLink`, part barcode images |
| `admin/` | Admin UI primitives + performance insights chrome |
| `auth/` | Auth split shell, session-expired dialog |
| `settings/` | Cross-cutting chrome (`ThemePicker`); domain settings UI stays in features |
| `theme/` | `ThemeProvider`, `ThemeScript` |
| `motion/` | Collapse, fade, chip/metric motion helpers |
| `shared/` | `BranchTree`, `ImagePreviewViewer` (UI widgets — not `src/shared/`) |
| `performance/` | Client metrics logger |

Import examples: `@/components/ui/Button`, `@/features/register/components/RegisterPageFilters`.
