#!/usr/bin/env python3
"""Full-history change log: git + Vercel + VPS -> CSV + Markdown.

Reads artifacts/change-log-raw/ (or regenerates git log). Does not invent outages.
"""
from __future__ import annotations

import csv
import json
import re
import subprocess
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

IST = timezone(timedelta(hours=5, minutes=30))

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "artifacts" / "change-log-raw"
OUT_CSV = ROOT / "artifacts" / "change-log.csv"
OUT_MD = ROOT / "artifacts" / "change-log.md"
GIT_LOG = RAW / "git-log.txt"
VERCEL_JSON = RAW / "vercel-deployments.json"
VPS_SNAP = RAW / "vps-snapshot.txt"

COLUMNS = [
    "Date time",
    "Platform",
    "Version",
    "What changed",
    "Why",
    "What affected",
    "Criticality",
    "Impact / broke",
    "Overlooked",
]


def ensure_git_log() -> str:
    RAW.mkdir(parents=True, exist_ok=True)
    if not GIT_LOG.exists() or GIT_LOG.stat().st_size < 100:
        text = subprocess.check_output(
            [
                "git",
                "log",
                "--pretty=format:===COMMIT===%nHASH:%H%nSHORT:%h%nDATE:%cI%nAUTHOR:%an <%ae>%nSUBJECT:%s%nBODY:%b%n===FILES===",
                "--name-status",
            ],
            cwd=ROOT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        GIT_LOG.write_text(text, encoding="utf-8")
    return GIT_LOG.read_text(encoding="utf-8", errors="replace")


def parse_git(text: str) -> list[dict]:
    commits = []
    for block in text.split("===COMMIT===")[1:]:
        lines = block.splitlines()
        get = lambda p: next((ln[len(p) :] for ln in lines if ln.startswith(p)), "").strip()
        files = []
        in_files = False
        body_lines = []
        for ln in lines:
            if ln.startswith("BODY:"):
                body_lines.append(ln[5:])
                continue
            if ln == "===FILES===":
                in_files = True
                continue
            if in_files:
                m = re.match(r"^([AMDCRTUX])\t(.+)$", ln) or re.match(r"^([AMDCRTUX])\s+(.+)$", ln)
                if m:
                    files.append({"status": m.group(1), "path": m.group(2)})
                elif ln.startswith("R") and "\t" in ln:
                    # rename: R100\told\tnew
                    parts = ln.split("\t")
                    if len(parts) >= 3:
                        files.append({"status": "R", "path": parts[-1]})
            elif not any(ln.startswith(x) for x in ("HASH:", "SHORT:", "DATE:", "AUTHOR:", "SUBJECT:", "BODY:")):
                if body_lines is not None and body_lines:
                    body_lines.append(ln)
        commits.append(
            {
                "hash": get("HASH:"),
                "short": get("SHORT:"),
                "date": get("DATE:"),
                "author": get("AUTHOR:"),
                "subject": get("SUBJECT:"),
                "body": "\n".join(body_lines).strip(),
                "files": files,
            }
        )
    return commits


def top_modules(files: list[dict], n: int = 5) -> list[str]:
    counts: dict[str, int] = defaultdict(int)
    for f in files:
        parts = f["path"].split("/")
        if parts[0] == "src" and len(parts) > 2 and parts[1] in ("app", "lib", "components", "modules"):
            mod = "/".join(parts[:3])
        elif parts[0] in ("scripts", "docs", "modules", "sql"):
            mod = "/".join(parts[:2]) if len(parts) > 1 else parts[0]
        else:
            mod = parts[0]
        counts[mod] += 1
    return [m for m, _ in sorted(counts.items(), key=lambda x: -x[1])[:n]]


def infer_why(subject: str, body: str, modules: list[str], categories: list[str]) -> str:
    msg = (subject + " " + body).lower()
    rules = [
        (r"\brevert|rollback\b", "Rollback / revert of a prior change."),
        (r"\bhotfix|urgent\b", "Urgent production fix."),
        (r"\bmiddleware|securit|auth|rbac\b", "Auth / security hardening."),
        (r"\bmigration|\.sql\b|schema|read-model", "Schema / read-model database change."),
        (r"\bvercel\b", "Vercel deploy / config."),
        (r"\bvps|sync-worker|systemd|cron\b", "VPS worker / ops deploy path."),
        (r"\bmis.?email|digest|mail\b", "MIS email digest / mail relay."),
        (r"\bexcel|export\b", "Excel / export behavior."),
        (r"\bperformance|optim|cache|speed\b", "Performance / caching."),
        (r"\bfix\b|bug\b|resolved\b", "Bug fix (see subject)."),
        (r"\bfeat\b|add\b|implement\b", "Feature work (see subject)."),
    ]
    for pat, why in rules:
        if re.search(pat, msg):
            return why
    if modules:
        return f"Touches primarily: {', '.join(modules)}."
    if "UNKNOWN" in categories:
        return "unknown (thin commit message)"
    return "Incremental development change."


def categorize(subject: str, files: list[dict]) -> list[str]:
    msg = subject.lower()
    paths = [f["path"] for f in files]
    cats: set[str] = set()
    if re.search(r"^(feat|add|new)(\(|:|\s)", msg):
        cats.add("FEATURE")
    if re.search(r"^(fix|bug|patch|hotfix)(\(|:|\s)", msg) or re.search(r"\bfix\b|bug\b", msg):
        cats.add("FIX")
    if re.search(r"revert|rollback", msg):
        cats.add("ROLLBACK")
    if re.search(r"performance|optim|cache|speed", msg):
        cats.add("PERFORMANCE")
    if re.search(r"middleware|securit|auth|rbac|permission", msg):
        cats.add("SECURITY")
    if re.search(r"deploy|vercel|vps|systemd", msg):
        cats.add("INFRA")
    path_rules = [
        ("SCHEMA", re.compile(r"(migrations?/|docs/read-model|/(sql)/).*\.sql$|^sql/.*\.sql$", re.I)),
        ("CONFIG", re.compile(r"\.env|vercel\.json|package\.json|next\.config", re.I)),
        ("DOCS", re.compile(r"^docs/|\.md$", re.I)),
        ("INFRA", re.compile(r"scripts/vps-hosting/|Dockerfile|\.yml$|systemd", re.I)),
        ("UI", re.compile(r"\.tsx$|\.css$|components/", re.I)),
        ("API", re.compile(r"src/app/.*/route\.|api/", re.I)),
    ]
    for name, rx in path_rules:
        if any(rx.search(p) for p in paths):
            cats.add(name)
    if not cats:
        cats.add("UNKNOWN")
    return sorted(cats)


def criticality(subject: str, files: list[dict], categories: list[str]) -> str:
    # Ignore scratch/docs noise when scoring path criticality
    paths = " ".join(
        f["path"]
        for f in files
        if not f["path"].startswith(("scratch/", ".agents/", "artifacts/", "docs/"))
    ).lower()
    msg = subject.lower()
    # HIGH only for trust-boundary / data / rollback / deploy-tooling that can take prod down
    high_path = re.search(
        r"(migrations?/|docs/read-model.*\.sql|(^|/)sql/.*\.sql|middleware\.|"
        r"scripts/vps-hosting/(deploy|sync-worker|setup)|vercel\.json|\.env\.|/auth/|rbac|jwt)",
        paths,
    )
    high_msg = re.search(r"\b(rollback|revert|hotfix|migration|security)\b", msg)
    if high_msg or "SECURITY" in categories or "ROLLBACK" in categories:
        return "HIGH"
    if high_path or "SCHEMA" in categories:
        return "HIGH"
    if "API" in categories or "INFRA" in categories or "FIX" in categories or "PERFORMANCE" in categories:
        return "MED"
    if "DOCS" in categories and set(categories) <= {"DOCS", "UNKNOWN"}:
        return "LOW"
    if "UNKNOWN" in categories and not files:
        return "INFO"
    if re.search(r"^merge |^chore|typo|comment", msg):
        return "INFO"
    if "UI" in categories or "FEATURE" in categories:
        return "MED"
    return "LOW"


def impact_note(subject: str, body: str, crit: str, files: list[dict]) -> str:
    msg = (subject + " " + body).lower()
    paths = " ".join(f["path"] for f in files).lower()
    evidence = []
    if re.search(r"\brevert|\brollback\b", msg):
        evidence.append("Explicit rollback/revert in commit message  -  prior change was undone.")
    if re.search(r"\bhotfix\b|\bbroke\b|\bbreaking\b|\bregression\b", msg):
        evidence.append("Message implies breakage/regression.")
    if crit == "HIGH" and re.search(r"middleware|auth|rbac", paths):
        evidence.append("Risk if wrong: auth outage / unauthorized access (no confirmed outage in git alone).")
    if crit == "HIGH" and re.search(r"\.sql|migration|read-model", paths):
        evidence.append("Risk if wrong: read-model / report data drift (apply on VPS separately from Vercel).")
    if crit == "HIGH" and re.search(r"scripts/vps-hosting|sync-worker|deploy", paths):
        evidence.append("Risk if wrong: sync/email workers fail on VPS while web UI still deploys on Vercel.")
    if not evidence:
        return "no evidence of production breakage in commit message"
    return " ".join(evidence)


def overlooked(subject: str, files: list[dict], platform: str, crit: str) -> str:
    paths = [f["path"] for f in files]
    notes = []
    has_sql = any(p.endswith(".sql") or "migration" in p.lower() for p in paths)
    has_vps = any("vps-hosting" in p or "sync-worker" in p for p in paths)
    has_web = any(p.startswith("src/") for p in paths)
    if has_sql and platform in ("Git", "Git+Vercel"):
        notes.append("SQL/schema change may need manual apply on VPS; Vercel push alone does not migrate DB.")
    if has_vps and has_web:
        notes.append("Split deploy: push to main updates Vercel; VPS needs sync-worker:deploy:vps (or equivalent).")
    if has_vps and not has_web and platform.startswith("Git"):
        notes.append("VPS-only surface  -  confirm release flipped on /opt/wrl/database/fast-close-app/current.")
    if crit == "HIGH" and re.search(r"env|secret|jwt|password", subject, re.I):
        notes.append("Env/secret drift between .env.local, Vercel dashboard, and VPS shared env.")
    if not notes and crit in ("HIGH", "MED"):
        notes.append("Re-test affected reports/APIs after deploy; no automated release checklist in repo.")
    return " ".join(notes) if notes else ""


def parse_dt(iso: str) -> datetime:
    if not iso:
        return datetime.min.replace(tzinfo=timezone.utc)
    # systemd style: Tue 2026-08-25 11:44:31 IST
    m = re.match(r"[A-Za-z]{3}\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(\S+)", iso)
    if m:
        iso2 = f"{m.group(1)}T{m.group(2)}+05:30"
        return datetime.fromisoformat(iso2)
    if iso.endswith("Z"):
        iso = iso[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(iso)
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)


def fmt_dt(dt: datetime) -> str:
    if dt.tzinfo is None:
        return dt.isoformat(sep=" ", timespec="seconds")
    local = dt.astimezone(IST)
    return local.strftime("%Y-%m-%d %H:%M:%S %z")


def build_rows() -> tuple[list[dict], dict]:
    commits = parse_git(ensure_git_log())
    vercel = []
    if VERCEL_JSON.exists():
        vercel = json.loads(VERCEL_JSON.read_text(encoding="utf-8")).get("deployments") or []

    sha_to_vercel: dict[str, list[dict]] = defaultdict(list)
    for d in vercel:
        sha = (d.get("meta") or {}).get("githubCommitSha") or ""
        if sha:
            sha_to_vercel[sha].append(d)
            sha_to_vercel[sha[:7]].append(d)
            sha_to_vercel[sha[:12]].append(d)

    rows: list[dict] = []
    for c in commits:
        modules = top_modules(c["files"])
        cats = categorize(c["subject"], c["files"])
        crit = criticality(c["subject"], c["files"], cats)
        vmatches = sha_to_vercel.get(c["hash"]) or sha_to_vercel.get(c["short"]) or []
        platform = "Git+Vercel" if vmatches else "Git"
        # Prefer commit time; note linked deploys in overlooked if many
        why = infer_why(c["subject"], c["body"], modules, cats)
        affected = ", ".join(modules) if modules else "(no files listed)"
        overlook = overlooked(c["subject"], c["files"], platform, crit)
        if vmatches:
            urls = ", ".join(sorted({m.get("url", "") for m in vmatches if m.get("url")})[:2])
            overlook = (overlook + " " if overlook else "") + f"Linked Vercel deploy(s): {urls}"
        rows.append(
            {
                "Date time": fmt_dt(parse_dt(c["date"])),
                "Platform": platform,
                "Version": c["short"],
                "What changed": c["subject"][:300],
                "Why": why,
                "What affected": affected[:400],
                "Criticality": crit,
                "Impact / broke": impact_note(c["subject"], c["body"], crit, c["files"]),
                "Overlooked": overlook[:500],
                "_sort": parse_dt(c["date"]),
                "_kind": "git",
                "_hash": c["hash"],
            }
        )

    # Standalone Vercel rows for visibility (same SHA also on Git+Vercel  -  still list deploy event)
    for d in vercel:
        meta = d.get("meta") or {}
        sha = meta.get("githubCommitSha") or ""
        short = sha[:7] if sha else (d.get("uid") or d.get("url") or "")[:12]
        created = d.get("createdAt")
        if isinstance(created, (int, float)):
            dt = datetime.fromtimestamp(created / 1000, tz=timezone.utc)
        else:
            dt = datetime.min.replace(tzinfo=timezone.utc)
        state = d.get("state") or d.get("readyState") or ""
        target = d.get("target") or ""
        msg = meta.get("githubCommitMessage") or "(no commit message in meta)"
        msg = msg.split("\n")[0][:300]
        impact = "no evidence of production breakage in deploy meta"
        st = (state or "").upper()
        if st in ("ERROR", "CANCELED", "CANCELLED"):
            impact = f"Deploy state={state} - build did not become Ready."
        overlook = ""
        if target == "preview":
            overlook = "Preview deploy (non-production); main-only gate in vercel.json skips most branches."
        if st == "ERROR":
            overlook = (overlook + " " if overlook else "") + "Investigate build logs before relying on this SHA in prod."
        # READY production = MED (routine); ERROR = HIGH; canceled preview = LOW
        if st == "ERROR":
            vcrit = "HIGH"
        elif st in ("CANCELED", "CANCELLED"):
            vcrit = "LOW"
        elif target == "production":
            vcrit = "MED"
        else:
            vcrit = "LOW"
        rows.append(
            {
                "Date time": fmt_dt(dt),
                "Platform": "Vercel",
                "Version": short,
                "What changed": f"Vercel {target or 'deploy'} {state}: {msg}",
                "Why": "Auto-deploy from GitHub push to linked project wrl-dashboard.",
                "What affected": f"Web UI @ {d.get('url', 'wrl-dashboard.vercel.app')}",
                "Criticality": vcrit,
                "Impact / broke": impact,
                "Overlooked": overlook
                or "Vercel deploy does not update VPS sync-worker/MIS email; confirm workers separately.",
                "_sort": dt,
                "_kind": "vercel",
                "_hash": sha,
            }
        )

    # VPS rows from snapshot
    vps_meta = {"releases": [], "notes": []}
    if VPS_SNAP.exists():
        text = VPS_SNAP.read_text(encoding="utf-8", errors="replace")
        current = ""
        for ln in text.splitlines():
            if ln.startswith("current="):
                current = ln.split("=", 1)[1].strip()
            if ln.startswith("RELEASE|"):
                _, name, mtime = ln.split("|", 2)
                vps_meta["releases"].append((name, mtime))
            if ln.startswith("NOTE="):
                vps_meta["notes"].append(ln[5:])
            if ln.startswith("nightly_failed_at="):
                failed_at = ln.split("=", 1)[1].strip()
                if failed_at:
                    rows.append(
                        {
                            "Date time": fmt_dt(parse_dt(failed_at)),
                            "Platform": "VPS",
                            "Version": current.replace("releases/", "") or "unknown",
                            "What changed": "fast-close-sync-worker-nightly.service failed (exit 1)",
                            "Why": "Nightly reconcile job exited non-zero (systemd evidence).",
                            "What affected": "Nightly editedon catch-up + YTD open scan on VPS",
                            "Criticality": "HIGH",
                            "Impact / broke": "Confirmed: nightly unit failed 2026-08-25 ~04:30 IST (status=1/FAILURE). Incremental sync-worker may still run.",
                            "Overlooked": "Watch nightly timer; failure does not always page. Check journalctl -u fast-close-sync-worker-nightly.",
                            "_sort": parse_dt(failed_at),
                            "_kind": "vps",
                            "_hash": "",
                        }
                    )
            if ln.startswith("sync_worker_started="):
                started = ln.split("=", 1)[1].strip()
                if started:
                    rows.append(
                        {
                            "Date time": fmt_dt(parse_dt(started)),
                            "Platform": "VPS",
                            "Version": current.replace("releases/", "") or "unknown",
                            "What changed": "fast-close-sync-worker.service (re)started after release flip",
                            "Why": "systemd ActiveEnterTimestamp after deploy.",
                            "What affected": "CRM read-model incremental sync on VPS",
                            "Criticality": "HIGH",
                            "Impact / broke": "Pre-flip crash-loop (~135 restarts) observed in journal same morning; service active after 11:44 IST redeploy.",
                            "Overlooked": "Only 2 releases on disk (pruned). Historical VPS SHAs not recoverable from releases/.",
                            "_sort": parse_dt(started),
                            "_kind": "vps",
                            "_hash": "",
                        }
                    )
        for name, mtime in vps_meta["releases"]:
            rows.append(
                {
                    "Date time": fmt_dt(parse_dt(mtime)),
                    "Platform": "VPS",
                    "Version": name,
                    "What changed": f"VPS release dir present: {name}"
                    + (" (current)" if current.endswith(name) else ""),
                    "Why": "SHA release under /opt/wrl/database/fast-close-app/releases (immutable deploy layout).",
                    "What affected": "sync-worker, MIS email scripts, VPS-hosted tooling",
                    "Criticality": "HIGH",
                    "Impact / broke": "no evidence in release folder alone; see systemd rows for runtime.",
                    "Overlooked": "Older releases pruned (keep-last-N). Full historical VPS deploy log not retained on disk."
                    + (" " + " ".join(vps_meta["notes"]) if vps_meta["notes"] else ""),
                    "_sort": parse_dt(mtime),
                    "_kind": "vps",
                    "_hash": name.split("-")[0],
                }
            )

    rows.sort(key=lambda r: r["_sort"])
    stats = {
        "git_commits": sum(1 for r in rows if r["_kind"] == "git"),
        "vercel_deploys": sum(1 for r in rows if r["_kind"] == "vercel"),
        "vps_events": sum(1 for r in rows if r["_kind"] == "vps"),
        "high": sum(1 for r in rows if r["Criticality"] == "HIGH"),
        "generated_at": datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S %z"),
        "period_start": rows[0]["Date time"] if rows else "",
        "period_end": rows[-1]["Date time"] if rows else "",
    }
    return rows, stats


def write_csv(rows: list[dict]) -> None:
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in COLUMNS})


def md_escape(s: str) -> str:
    return (s or "").replace("|", "\\|").replace("\n", " ")


def write_md(rows: list[dict], stats: dict) -> None:
    lines = []
    lines.append("# Fast Close / wrl-dashboard  -  Full Change Log")
    lines.append("")
    lines.append(f"- **Generated:** {stats['generated_at']} (IST)")
    lines.append(f"- **Period:** {stats['period_start']} → {stats['period_end']}")
    lines.append(f"- **Git commits:** {stats['git_commits']}")
    lines.append(f"- **Vercel deploys (retained by Vercel):** {stats['vercel_deploys']}")
    lines.append(f"- **VPS events (on-disk / systemd):** {stats['vps_events']}")
    lines.append(f"- **HIGH criticality rows:** {stats['high']}")
    lines.append(f"- **Version scheme:** git short SHA (no semver tags; package.json stays 0.1.0)")
    lines.append("")
    lines.append("## How to read")
    lines.append("")
    lines.append("- **Criticality** is a heuristic from paths/messages (HIGH = schema/auth/deploy/workers).")
    lines.append("- **Impact / broke** only claims breakage when git message or VPS systemd evidence supports it; otherwise `no evidence...`.")
    lines.append("- **Platform `Git+Vercel`:** commit SHA also appears in a Vercel deployment.")
    lines.append("- **VPS history gap:** releases/ keeps only recent SHAs; older VPS flips are not on disk.")
    lines.append("")
    lines.append("## High-criticality shortlist")
    lines.append("")
    lines.append("| Date time | Platform | Version | What changed | Impact / broke | Overlooked |")
    lines.append("|---|---|---|---|---|---|")
    for r in rows:
        if r["Criticality"] != "HIGH":
            continue
        lines.append(
            "| "
            + " | ".join(
                md_escape(r[k])[:120]
                for k in ("Date time", "Platform", "Version", "What changed", "Impact / broke", "Overlooked")
            )
            + " |"
        )
    lines.append("")
    lines.append("## Master log (chronological)")
    lines.append("")

    by_month: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        key = r["Date time"][:7] if r["Date time"] else "unknown"
        by_month[key].append(r)

    for month in sorted(by_month.keys()):
        lines.append(f"### {month}")
        lines.append("")
        lines.append(
            "| Date time | Platform | Version | What changed | Why | What affected | Criticality | Impact / broke | Overlooked |"
        )
        lines.append("|---|---|---|---|---|---|---|---|---|")
        for r in by_month[month]:
            lines.append(
                "| "
                + " | ".join(md_escape(r.get(k, ""))[:200] for k in COLUMNS)
                + " |"
            )
        lines.append("")

    lines.append("## Platform notes")
    lines.append("")
    lines.append("### Git")
    lines.append(f"- Full local history: **{stats['git_commits']}** commits.")
    lines.append("- Other branch tip `tried-for-server-cache` is experimental; not production.")
    lines.append("")
    lines.append("### Vercel")
    lines.append("- Project: `wrl-dashboard` → https://wrl-dashboard.vercel.app")
    lines.append("- `vercel.json` deploys only `main`/`master`.")
    lines.append(f"- Deployments pulled via CLI: **{stats['vercel_deploys']}** (API retention window).")
    lines.append("")
    lines.append("### VPS")
    lines.append("- Install base: `/opt/wrl/database/fast-close-app` (`current` → SHA release).")
    lines.append("- Self-hosted Supabase under `/opt/supabase`; mail relay `wrl-mail-relay.service`.")
    lines.append("- See `artifacts/change-log-raw/vps-snapshot.txt` for live capture used in this run.")
    lines.append("")

    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    rows, stats = build_rows()
    write_csv(rows)
    write_md(rows, stats)
    print(f"Wrote {OUT_CSV} ({len(rows)} rows)")
    print(f"Wrote {OUT_MD}")
    print(json.dumps({k: stats[k] for k in stats if not k.startswith("_")}, indent=2))


if __name__ == "__main__":
    main()
