# Dependency Risk Register (Phase 1)

This document records dependency security posture after Phase 1 remediation (`npm audit fix` without breaking changes).

## Fixed in Phase 1

The safe audit remediation removed previously reported critical/high issues that were patchable without forced major downgrades/upgrades, including packages in these trees:

- `vitest` advisory chain (critical)
- `undici` advisory chain (high)
- `hono` advisory chain (high)
- `form-data` advisory chain (high)
- `dompurify` advisory chain (moderate)
- `tmp`, `js-yaml`, `@opentelemetry/*`, and related moderate chains

## Remaining Risks (deferred)

`npm audit` currently reports residual vulnerabilities that need non-trivial or breaking actions:

1. `xlsx` (high) - no upstream fix available
   - Advisories: prototype pollution / ReDoS
   - Current decision: **defer**, apply compensating controls (below).

2. `@hono/node-server` (moderate) via `prisma` dev dependency chain
   - Fix requires `npm audit fix --force`, which would install `prisma@6.x` (breaking relative to current setup).
   - Current decision: **defer to dedicated Prisma upgrade track**.

3. `postcss` (moderate) in `next` transitive tree
   - Force fix path suggests incompatible `next` major downgrade in audit solver output.
   - Current decision: **defer**, resolve through controlled Next.js upgrade path.

4. `uuid` (moderate) via `exceljs`
   - Force fix suggests `exceljs@3.4.0` (downgrade + likely incompatibility).
   - Current decision: **defer**, evaluate `exceljs` replacement/upgrade matrix.

5. `esbuild` (moderate)
   - Dev-server context vulnerability on Windows in affected range.
   - Current decision: **defer short-term**, track in next dependency refresh.

## Compensating Controls

- Keep CI `npm audit --audit-level=high` as a required check.
- Restrict untrusted file handling paths and validate spreadsheet inputs before parsing.
- Prefer server-side parsing isolation for `xlsx` inputs and enforce strict file size/type checks.
- Run monthly dependency review and re-check deferred items for newly available fixes.

## Next Actions

- Create a dedicated Phase 2 dependency PR for:
  - Prisma major migration planning.
  - Next.js dependency refresh and transitive vulnerability review.
  - Spreadsheet parser hardening and potential migration away from vulnerable `xlsx`.
