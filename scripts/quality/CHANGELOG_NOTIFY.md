# Push change-log notify

On every push to `main` / `master`:

1. **GitHub Action** [`.github/workflows/change-log-notify.yml`](../../.github/workflows/change-log-notify.yml) appends to `artifacts/change-log-auto.md` + `.csv`, checks Vercel (if token set), and **emails risks / overlooked**.
2. **Local husky `post-push`** also appends the local auto log (email skipped unless `CHANGELOG_MAIL_LOCAL=1`).

Manual:

```bash
npm run changelog:notify
npm run changelog:notify -- --before <sha> --after <sha>
```

## GitHub secrets

| Secret | Required | Purpose |
|--------|----------|---------|
| `SMTP_HOST` | yes (for mail) | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | no | default 587 |
| `SMTP_USER` | yes if not local relay | SMTP user |
| `SMTP_PASS` | yes if not local relay | app password |
| `SMTP_FROM` | yes | From header |
| `CHANGELOG_MAIL_TO` | no | default `vishnu.vishwakarma@westernequipments.com` |
| `VERCEL_TOKEN` | no | look up deploy Ready/Error for the SHA |
| `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | no | else `.vercel/project.json` |

Optional repo **variable** `CHANGELOG_MAIL_ALWAYS=1` to email even when no risks.

## What gets emailed

Email sends when the push has HIGH criticality, overlooked follow-ups (Vercel/VPS/SQL), or a failed Vercel deploy check. Pure docs-only pushes with no risks are logged only.

**VPS is never auto-deployed by git push** — the mail will remind you to run `npm run sync-worker:deploy:vps` when worker/SQL paths change.
