# `src/sql`

Central home for **SQL string builders / query leaves**. Orchestration (fetch, auth, route handlers) stays in `src/modules/*/server`.

```text
src/sql/
  arcp/             # query builders + postgres hot-table queries
  warranty/         # warranty master SQL
  register/         # register enrich / WCO / ARCP approve-date SQL (was lib/register-sql)
  trhcalls/         # TRHCalls CRM SQL helpers (was lib/trhcalls)
  read-model/       # hot-table register/summary/drilldown SQL (was lib/read-model/queries)
  repair/           # repair filter SQL options (was lib/repair)
  location-audit/   # location audit list/detail SQL
  serial-history/   # serial-audit SQL scope helpers
```

Import: `@/sql/<domain>/...` (e.g. `@/sql/arcp/query`, `@/sql/warranty`).

Schema DDL (CREATE TABLE) remains in `docs/read-model-phase1-schema/` — that is migrations, not fetch SQL.
