# ARCP Provision

Two views (Claims-style toggle):

- **Summary** — Branch → `BREAKDOWN – category` → Local/Upcountry · Major/Minor clubbed rows (rate unit × qty vs CRM). Travel rollup per branch.
- **Detail** — Branch → Vendor → individual calls (+ travel lines).

```text
/report/arcp-provision
GET /api/report/arcp-provision
  mode=category-aggregates | aggregates | detail | options | summary
```

Call No in detail = service order `vucnno`. Cancelled calls excluded. Rate join: `mstarcpcccr.noffice` = `office_under`.

**BREAKDOWN Major / Minor (rate master):** only `nrepairtype` **Gas Charging Done (6)** and **Compressor Replaced (19)** use Major rate-card rows; all other BREAKDOWN lines use Minor (blank `nrepairtype`) rates.

Auth: `page_arcp_provision`. Sync: `SYNC_ARCP_ENABLED=true`.

Backfill repair onto hot (editedon window):

```bash
npx tsx scripts/tmp-backfill-arcp-repairtype.ts 2026-08-01 2026-09-01
```
