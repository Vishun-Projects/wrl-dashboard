# `src/shared`

Cross-cutting code only (auth primitives, db pool wrappers, UI kit leaves, net helpers).

**Import rule (enforced by `npm run check:feature-boundaries`):**

- `features/A` may import `shared/*` and other features’ **`index.ts`** (or `@/features/<b>` package root) only — not deep `@/features/<b>/lib/...` from another feature.
- `shared/*` must not import `features/*`.

Until more infra is extracted from `src/lib`, prefer leaving true shared pieces here when they have **two or more** feature consumers; do not create speculative folders.
