# `src/shared`

**Placeholder only.** Platform infra lives in `src/lib/` today. Bulk `lib` → `shared` rename is deferred until a few modules have landed.

When the rename happens:

- Domains may import `shared/*` and other domains’ **`index.ts`** only.
- `shared/*` must not import `features/*` or `modules/*`.

Until then: put cross-cutting platform code in `src/lib/`. Domain-owned code (e.g. ARCP) belongs in `src/modules/<name>/`, not here.
