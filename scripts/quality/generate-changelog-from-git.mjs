#!/usr/bin/env node
/**
 * Parses extracted git audit files and generates DEVELOPMENT_HISTORY.md
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = join(__dirname, "../../docs/git-audit");
const OUT_FILE = join(__dirname, "../../docs/DEVELOPMENT_HISTORY.md");

function parseDetailedLog(text) {
  const commits = [];
  const blocks = text.split("=== COMMIT START ===").slice(1);

  for (const block of blocks) {
    const lines = block.split("\n");
    const get = (prefix) => {
      const line = lines.find((l) => l.startsWith(prefix));
      return line ? line.slice(prefix.length).trim() : "";
    };

    const hash = get("HASH: ");
    const short = get("SHORT: ");
    const date = get("DATE: ");
    const author = get("AUTHOR: ");
    const branchTag = get("BRANCH/TAG: ");
    const message = get("MESSAGE: ");

    const filesIdx = lines.findIndex((l) => l === "=== FILES ===");
    const files = [];
    if (filesIdx >= 0) {
      for (let i = filesIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const m = line.match(/^([AMDRTCU?])\s+(.+)$/);
        if (m) files.push({ status: m[1], path: m[2] });
      }
    }

    commits.push({ hash, short, date, author, branchTag, message, files });
  }
  return commits;
}

function parseStatLog(text) {
  const stats = new Map();
  const blocks = text.split(/\n(?=HASH: )/);
  for (const block of blocks) {
    const header = block.match(/^HASH: ([a-f0-9]+)/);
    if (!header) continue;
    const hash = header[1];
    const summary = block.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
    stats.set(hash, {
      filesChanged: summary ? parseInt(summary[1], 10) : 0,
      insertions: summary && summary[2] ? parseInt(summary[2], 10) : 0,
      deletions: summary && summary[3] ? parseInt(summary[3], 10) : 0,
    });
  }
  return stats;
}

function categorize(commit) {
  const msg = commit.message.toLowerCase();
  const paths = commit.files.map((f) => f.path);
  const added = commit.files.filter((f) => f.status === "A").map((f) => f.path);
  const categories = new Set();

  const prefixRules = [
    ["FEATURE", /^(feat|add|new):/],
    ["FIX", /^(fix|bug|patch|hotfix):/],
    ["REFACTOR", /^(refactor|cleanup|restructure):/],
    ["MERGE", /^merge /],
  ];
  for (const [cat, re] of prefixRules) {
    if (re.test(msg)) categories.add(cat);
  }

  if (/resolved|error|bug|fix/.test(msg)) categories.add("FIX");
  if (/performance|speed|optim|cache|local storage|localstorage/.test(msg)) categories.add("PERFORMANCE");
  if (/middleware|securit|auth|permission|token|encrypt|sanitize|guard|rbac/.test(msg)) categories.add("SECURITY");
  if (/deploy|vercel/.test(msg)) categories.add("INFRA / DEVOPS");
  if (/initial commit|first commit|project setup|^init/.test(msg)) categories.add("INITIAL / SETUP");
  if (/excel|export|report|page|sidebar|layout|filter|dashboard|ui|mobile/.test(msg)) categories.add("FEATURE");
  if (/removed|clean up|cleanup|saaf/.test(msg)) categories.add("REFACTOR");

  const pathChecks = [
    ["SCHEMA / DB", /migrations?\/|seeds?\/|schema\/|\.sql$|prisma/],
    ["CONFIG", /\.env|config\/|docker-compose|package\.json|tsconfig|\.eslintrc|next\.config/],
    ["DOCS", /^README|CHANGELOG|\.md$|^docs\//],
    ["TEST", /\.test\.|\.spec\.|__tests__\/|^tests\//],
    ["STYLE / UI", /\.css$|\.scss$|tailwind\.config|globals\.css/],
    ["INFRA / DEVOPS", /Dockerfile|\.yml$|\.yaml$|nginx\.conf|vercel\.json/],
  ];
  for (const [cat, re] of pathChecks) {
    if (paths.some((p) => re.test(p))) categories.add(cat);
  }

  const newFeaturePaths = added.filter((p) =>
    /^(src\/(app|components|pages|routes|modules)\/)/.test(p)
  );
  if (newFeaturePaths.length > 0) categories.add("FEATURE");

  const onlyPkg = paths.length > 0 && paths.every((p) => /package\.json|package-lock|yarn\.lock/.test(p));
  if (onlyPkg) categories.add("DEPENDENCY");

  if (categories.size === 0) categories.add("UNKNOWN");

  return [...categories].sort();
}

function weekStart(dateStr) {
  const d = new Date(dateStr.slice(0, 10));
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}

function monthLabel(key) {
  const [y, m] = key.split("-");
  const names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${names[parseInt(m, 10) - 1]} ${y}`;
}

function topModules(files) {
  const counts = new Map();
  for (const { path } of files) {
    const parts = path.split("/");
    let mod = parts[0];
    if (parts[0] === "src" && parts.length > 1) mod = `src/${parts[1]}`;
    if (parts[0] === "src" && parts[1] === "app" && parts.length > 2) mod = `src/app/${parts[2]}`;
    if (parts[0] === "src" && parts[1] === "lib" && parts.length > 2) mod = `src/lib/${parts[2]}`;
    counts.set(mod, (counts.get(mod) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([m]) => m);
}

function inferPurpose(commit, categories) {
  const msg = commit.message;
  const modules = topModules(commit.files);
  if (categories.includes("INITIAL / SETUP")) return "Project bootstrap — Next.js app scaffold.";
  if (msg.includes("arcp claims")) return "ARCP claims reporting: Postgres read-model sync, hybrid load, and UI.";
  if (msg.includes("distribution") && msg.includes("idle")) return "Call distribution report: idle technician assignment logic and UI.";
  if (msg.includes("crm mention")) return "Remove CRM-specific terminology from user-facing copy and error messages.";
  if (msg.includes("excel")) return "Fix Excel export formatting/encoding bug in register reports.";
  if (msg.includes("serial")) return "Serial-wise history audit page and related APIs.";
  if (msg.includes("corpus caching")) return "Report corpus caching layer, register filter UI, serial audit APIs.";
  if (msg.includes("performance") || msg.includes("local storage")) return "Client-side caching via localStorage to reduce API load and improve page speed.";
  if (msg.includes("middleware") || msg.includes("securit")) return "Auth middleware and security hardening.";
  if (msg.includes("rbac") || msg.includes("profile setting")) return "RBAC admin page and user profile settings.";
  if (msg.includes("excel export")) return "Excel/CSV export for MIS reports.";
  if (msg.includes("reports page")) return "Core MIS reports listing and refresh workflow.";
  if (msg.includes("branch manager")) return "Branch-manager scoped view and sidebar navigation.";
  if (msg.includes("cron")) return "Cron job configuration for read-model sync (later removed from Vercel).";
  if (msg.includes("vercel")) return "Vercel deployment configuration and type-error fixes.";
  if (msg.includes("mobile")) return "Mobile layout fixes and visits tab behavior.";
  if (modules.length) return `Touches primarily: ${modules.join(", ")}.`;
  return "Incremental development change.";
}

function formatCommitEntry(c, stat, categories) {
  const dateOnly = c.date.slice(0, 10);
  const time = c.date.slice(11);
  const s = stat.get(c.hash) || { filesChanged: c.files.length, insertions: 0, deletions: 0 };
  const added = c.files.filter((f) => f.status === "A");
  const modified = c.files.filter((f) => f.status === "M");
  const deleted = c.files.filter((f) => f.status === "D");
  const purpose = inferPurpose(c, categories);

  let filesSummary = "";
  if (added.length) filesSummary += `\n  - **Added (${added.length}):** ${added.slice(0, 8).map((f) => `\`${f.path}\``).join(", ")}${added.length > 8 ? `, +${added.length - 8} more` : ""}`;
  if (modified.length) filesSummary += `\n  - **Modified (${modified.length}):** ${modified.slice(0, 6).map((f) => `\`${f.path}\``).join(", ")}${modified.length > 6 ? `, +${modified.length - 6} more` : ""}`;
  if (deleted.length) filesSummary += `\n  - **Deleted (${deleted.length}):** ${deleted.map((f) => `\`${f.path}\``).join(", ")}`;

  return `#### \`${c.short}\` — ${c.message}
- **When:** ${dateOnly} ${time}
- **Author:** ${c.author}
- **Branch/Tag:** ${c.branchTag || "_main line_"}
- **Category:** ${categories.join(", ")}
- **Stats:** ${s.filesChanged} files, +${s.insertions}/-${s.deletions} lines
- **Purpose:** ${purpose}${filesSummary}
`;
}

function categorySummary(commitsWithCat) {
  const counts = {};
  for (const { categories } of commitsWithCat) {
    for (const c of categories) counts[c] = (counts[c] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function main() {
  const detailed = readFileSync(join(AUDIT_DIR, "git_detailed_log.txt"), "utf8");
  const stat = parseStatLog(readFileSync(join(AUDIT_DIR, "git_stat_log.txt"), "utf8"));
  const branches = readFileSync(join(AUDIT_DIR, "git_branches.txt"), "utf8").trim().split("\n").filter(Boolean);
  const contributors = readFileSync(join(AUDIT_DIR, "git_contributors.txt"), "utf8").trim();
  const startDate = readFileSync(join(AUDIT_DIR, "git_start_date.txt"), "utf8").trim();
  const endDate = readFileSync(join(AUDIT_DIR, "git_end_date.txt"), "utf8").trim();

  const commits = parseDetailedLog(detailed);
  const enriched = commits.map((c) => ({
    ...c,
    categories: categorize(c),
  }));

  const fmt = (n) => n.toLocaleString("en-US");
  const totalInsertions = [...stat.values()].reduce((a, s) => a + s.insertions, 0);
  const totalDeletions = [...stat.values()].reduce((a, s) => a + s.deletions, 0);
  const contributorLines = contributors
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^\s*\d+\s+/, ""))
    .join("; ");

  // Group by week
  const byWeek = new Map();
  for (const c of enriched) {
    const wk = weekStart(c.date);
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk).push(c);
  }

  // Group by month
  const byMonth = new Map();
  for (const c of enriched) {
    const mk = monthKey(c.date);
    if (!byMonth.has(mk)) byMonth.set(mk, []);
    byMonth.get(mk).push(c);
  }

  // Group by module
  const byModule = new Map();
  for (const c of enriched) {
    for (const mod of topModules(c.files)) {
      if (!byModule.has(mod)) byModule.set(mod, []);
      byModule.get(mod).push(c);
    }
  }

  const catCounts = categorySummary(enriched);

  let md = `# Development History & Changelog

> **Repository:** fast-close-app  
> **Generated:** ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC  
> **Period:** ${startDate} → ${endDate}  
> **Total commits:** ${commits.length}  
> **Contributors:** ${contributorLines}  
> **Lines changed (approx.):** +${fmt(totalInsertions)} / -${fmt(totalDeletions)}

---

## Executive Summary

This document is an audit of the complete Git history for **fast-close-app**, a Next.js MIS/reporting application for field-service operations (calls, distribution, ARCP claims, serial audit, register exports). Development spans **${Math.ceil((new Date(endDate) - new Date(startDate)) / (86400000 * 7))} weeks** (${startDate} to ${endDate}), with **${commits.length} commits** by a single contributor (**VV**).

### Milestones

| Date | Milestone |
|------|-----------|
| 2026-05-12 | **Initial commit** — Next.js app scaffold via Create Next App |
| 2026-05-14 | First feature commit — mobile fixes, visits tab |
| 2026-05-15 | **Reports module** — MIS reports page, Excel export, summary dashboard verification |
| 2026-05-16 | **Security** — middleware and auth hardening |
| 2026-05-18 | **RBAC & profile settings**, Vercel deployment, performance work |
| 2026-05-19–20 | Client-side performance (localStorage), calls page, MIS localStorage indexing |
| 2026-05-21 | Performance optimizations (localStorage reload technique) |
| 2026-05-22 | Branch manager view; experimental \`tried-for-server-cache\` branch |
| 2026-05-25 | **Read-model phase** — corpus caching, register filters, serial audit APIs |
| 2026-05-26–27 | New DB integrations, ARCP claims page, serial-wise history, cron jobs |
| 2026-05-27 | Excel export bug fix, performance tuning, Vercel cron removal |
| 2026-05-29 | **ARCP Postgres sync** (Jan 2025–May 2026 data), idle technician distribution, CRM label cleanup |

### Commit Categories (all commits, multi-tag allowed)

| Category | Count |
|----------|-------|
${catCounts.map(([c, n]) => `| ${c} | ${n} |`).join("\n")}

### Branches

| Branch | Tip | Last Updated | Latest Subject |
|--------|-----|--------------|----------------|
${branches.map((b) => {
  const [name, tip, date, ...subj] = b.split("|");
  return `| \`${name}\` | \`${tip}\` | ${date} | ${subj.join("|")} |`;
}).join("\n")}

### Tags / Releases

_No tags found in repository._

---

## Timeline by Month

`;

  for (const [mk, monthCommits] of [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    const monthInsertions = monthCommits.reduce((a, c) => a + (stat.get(c.hash)?.insertions || 0), 0);
    const monthDeletions = monthCommits.reduce((a, c) => a + (stat.get(c.hash)?.deletions || 0), 0);
    md += `### ${monthLabel(mk)}

- **Commits:** ${monthCommits.length}
- **Lines:** +${fmt(monthInsertions)} / -${fmt(monthDeletions)}
- **Highlights:** ${[...new Set(monthCommits.map((c) => c.message))].slice(0, 5).join("; ")}${monthCommits.length > 5 ? "…" : ""}

`;
  }

  md += `---

## Timeline by Week

`;

  for (const [wk, weekCommits] of [...byWeek.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    md += `### Week of ${wk}

_${weekCommits.length} commit(s)_

`;
    for (const c of weekCommits) {
      md += formatCommitEntry(c, stat, c.categories);
      md += "\n";
    }
  }

  md += `---

## History by Module / Folder

`;

  for (const [mod, modCommits] of [...byModule.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const unique = [...new Map(modCommits.map((c) => [c.hash, c])).values()];
    md += `### \`${mod}\` (${unique.length} commits)

`;
    for (const c of unique.sort((a, b) => b.date.localeCompare(a.date))) {
      md += `- **${c.date.slice(0, 10)}** \`${c.short}\` — ${c.message} _[${c.categories.join(", ")}]_\n`;
    }
    md += "\n";
  }

  md += `---

## Complete Commit Log (reverse chronological)

`;

  for (const c of enriched) {
    md += formatCommitEntry(c, stat, c.categories);
    md += "\n";
  }

  md += `---

## Appendix: Raw Data Files

Extracted during audit (Phase 1):

| File | Description |
|------|-------------|
| \`docs/git-audit/git_full_log.txt\` | Full commit log with graph |
| \`docs/git-audit/git_detailed_log.txt\` | Per-commit file change list |
| \`docs/git-audit/git_stat_log.txt\` | Diff stats per commit |
| \`docs/git-audit/git_branches.txt\` | Branch tips |
| \`docs/git-audit/git_tags.txt\` | Tags (empty) |
| \`docs/git-audit/git_remote_log.txt\` | Remote-tracking history |
| \`docs/git-audit/git_contributors.txt\` | Contributor summary |

---

*Document auto-generated by \`scripts/quality/generate-changelog-from-git.mjs\`*
`;

  writeFileSync(OUT_FILE, md, "utf8");
  console.log(`Wrote ${OUT_FILE} (${md.length} bytes, ${commits.length} commits)`);
}

main();
