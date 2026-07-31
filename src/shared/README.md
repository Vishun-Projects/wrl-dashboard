# `src/shared`

**Placeholder only.** Shared infrastructure lives in `src/lib/` today. A bulk `lib` → `shared` rename is deferred — do not add new code here until that migration happens.

When the rename lands:

- `features/A` may import `shared/*` and other features’ **`index.ts`** only — not deep `@/features/<b>/…` paths.
- `shared/*` must not import `features/*`.

Until then: put cross-cutting infra in `src/lib/`. Prefer extracting a leaf into `lib/` when **two or more** features need it; do not create speculative folders.
