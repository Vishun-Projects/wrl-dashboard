#!/usr/bin/env node
/**
 * After a git push: append a change-log row and email risks / overlooked items.
 *
 * Usage:
 *   node scripts/quality/notify-push-change-log.mjs
 *   node scripts/quality/notify-push-change-log.mjs --before <sha> --after <sha>
 *
 * Env:
 *   CHANGELOG_MAIL_TO   recipient (default: vishnu.vishwakarma@westernequipments.com)
 *   CHANGELOG_MAIL_ALWAYS=1  email even when no HIGH risks (default: email only on risks / Vercel fail)
 *   CHANGELOG_SKIP_MAIL=1    never email (log only)
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM  (or load from .env.mis-email / .env.local)
 *   VERCEL_TOKEN + VERCEL_ORG_ID / project from .vercel/project.json  (optional deploy check)
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nodemailer = require("nodemailer");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT_DIR = join(ROOT, "artifacts");
const AUTO_MD = join(OUT_DIR, "change-log-auto.md");
const AUTO_CSV = join(OUT_DIR, "change-log-auto.csv");

const DEFAULT_TO = "vishnu.vishwakarma@westernequipments.com";

function parseArgs(argv) {
  const out = { before: "", after: "" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--before") out.before = argv[++i] || "";
    else if (argv[i] === "--after") out.after = argv[++i] || "";
  }
  return out;
}

function git(args, opts = {}) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  }).trim();
}

function loadEnvFiles() {
  for (const name of [".env.mis-email", ".env.local", ".env"]) {
    const p = join(ROOT, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      const key = m[1];
      if (process.env[key]) continue;
      let val = m[2].trim();
      if (
        (val.startsWith("'") && val.endsWith("'")) ||
        (val.startsWith('"') && val.endsWith('"'))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

function resolveRange(args) {
  let after = args.after || process.env.GITHUB_SHA || "";
  let before = args.before || process.env.GITHUB_EVENT_BEFORE || "";

  if (!after) {
    try {
      after = git(["rev-parse", "HEAD"]);
    } catch {
      after = "";
    }
  }
  if (!before || before === "0000000000000000000000000000000000000000") {
    try {
      before = git(["rev-parse", `${after}^`]);
    } catch {
      before = "";
    }
  }
  return { before, after };
}

function listCommits(before, after) {
  const range = before ? `${before}..${after}` : after;
  const fmt = "%H%x09%h%x09%cI%x09%s";
  let out = "";
  try {
    out = git(["log", "--format=" + fmt, range]);
  } catch {
    out = git(["log", "-1", "--format=" + fmt, after || "HEAD"]);
  }
  if (!out) return [];
  return out.split("\n").filter(Boolean).map((line) => {
    const [hash, short, date, ...rest] = line.split("\t");
    return { hash, short, date, subject: rest.join("\t") };
  });
}

function filesChanged(before, after) {
  try {
    if (before) {
      return git(["diff", "--name-only", `${before}...${after}`])
        .split("\n")
        .filter(Boolean);
    }
    return git(["show", "--name-only", "--format=", after || "HEAD"])
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function topModules(files) {
  const counts = new Map();
  for (const path of files) {
    const parts = path.split("/");
    let mod = parts[0];
    if (parts[0] === "src" && parts.length > 2) mod = parts.slice(0, 3).join("/");
    if (parts[0] === "scripts" && parts.length > 1) mod = parts.slice(0, 2).join("/");
    counts.set(mod, (counts.get(mod) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([m]) => m);
}

function analyze(subject, files) {
  const msg = subject.toLowerCase();
  const paths = files
    .filter((p) => !p.startsWith("scratch/") && !p.startsWith("artifacts/") && !p.startsWith(".agents/"))
    .join(" ");
  const risks = [];
  const overlooked = [];

  const highPath =
    /migrations?\/|docs\/read-model|\/sql\/.*\.sql|middleware\.|scripts\/vps-hosting\/(deploy|sync-worker|setup)|vercel\.json|\.env\.|\/auth\/|rbac|jwt|upsert-cancelled|read-model\//i.test(
      paths
    );
  const highMsg = /\b(rollback|revert|hotfix|migration|security)\b/i.test(msg);

  let criticality = "LOW";
  if (highMsg || highPath) criticality = "HIGH";
  else if (/fix|bug|api|sync|worker|performance/i.test(msg + paths)) criticality = "MED";

  const touchesSql = /\.sql$|migrations?\//i.test(paths);
  const touchesVps = /scripts\/vps-hosting|sync-worker|read-model\//i.test(paths);
  const touchesWeb = /^src\//m.test(files.join("\n")) || files.some((f) => f.startsWith("src/"));
  const touchesVercel = /vercel\.json/i.test(paths);

  if (touchesWeb || touchesVercel) {
    overlooked.push(
      "Vercel: push to main auto-deploys wrl-dashboard. Confirm deploy Ready (not Error) before trusting UI."
    );
  }
  if (touchesVps || touchesSql) {
    overlooked.push(
      "VPS: not auto-updated by git push. Run sync-worker deploy (npm run sync-worker:deploy:vps) if workers/SQL changed — or sync-worker can crash (missing modules)."
    );
  }
  if (touchesSql) {
    overlooked.push(
      "DB: SQL/schema may need manual apply on VPS; Vercel alone does not migrate Postgres."
    );
  }
  if (/\brollback\b|\brevert\b/i.test(msg)) {
    risks.push("Commit is an explicit rollback/revert — verify prod matches intended state on Vercel and VPS.");
  }
  if (highPath && /read-model|upsert-cancelled|sync-worker/i.test(paths)) {
    risks.push(
      "Read-model / sync-worker code changed — if VPS release is stale, daemon can crash-loop (missing module)."
    );
  }
  if (criticality === "HIGH") {
    risks.push("HIGH criticality paths/messages — re-test auth/reports/sync after deploy.");
  }

  return {
    criticality,
    affected: topModules(files).join(", ") || "(no files)",
    risks,
    overlooked: [...new Set(overlooked)],
    platforms: [
      "Git",
      touchesWeb || touchesVercel ? "Vercel" : null,
      touchesVps || touchesSql ? "VPS" : null,
    ].filter(Boolean),
  };
}

async function checkVercel(sha) {
  const token = process.env.VERCEL_TOKEN?.trim();
  if (!token || !sha) return { ok: null, detail: "VERCEL_TOKEN not set — skipped deploy check" };

  let projectId = process.env.VERCEL_PROJECT_ID || "";
  let orgId = process.env.VERCEL_ORG_ID || "";
  try {
    const pj = JSON.parse(readFileSync(join(ROOT, ".vercel/project.json"), "utf8"));
    projectId = projectId || pj.projectId;
    orgId = orgId || pj.orgId;
  } catch {
    /* optional */
  }
  if (!projectId) return { ok: null, detail: "No Vercel project id" };

  const url = new URL("https://api.vercel.com/v6/deployments");
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("limit", "20");
  if (orgId) url.searchParams.set("teamId", orgId);

  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      return { ok: null, detail: `Vercel API ${res.status} — token may be expired` };
    }
    const data = await res.json();
    const deps = data.deployments || [];
    const match = deps.find(
      (d) =>
        (d.meta && d.meta.githubCommitSha === sha) ||
        (d.meta && String(d.meta.githubCommitSha || "").startsWith(sha.slice(0, 7)))
    );
    if (!match) {
      return {
        ok: null,
        detail: "No Vercel deployment found yet for this SHA (may still be building)",
      };
    }
    const state = match.state || match.readyState || "";
    const ok = String(state).toUpperCase() === "READY";
    return {
      ok,
      detail: `Vercel ${match.target || "deploy"} ${state} — ${match.url || ""}`,
      state,
      url: match.url,
    };
  } catch (err) {
    return { ok: null, detail: `Vercel check failed: ${err.message}` };
  }
}

function csvEscape(s) {
  const t = String(s ?? "");
  if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function appendLog(entry) {
  mkdirSync(OUT_DIR, { recursive: true });
  const header =
    "Date time,Platform,Version,What changed,Why,What affected,Criticality,Impact / broke,Overlooked\n";
  if (!existsSync(AUTO_CSV)) writeFileSync(AUTO_CSV, header, "utf8");

  const row = [
    entry.dateTime,
    entry.platform,
    entry.version,
    entry.what,
    entry.why,
    entry.affected,
    entry.criticality,
    entry.impact,
    entry.overlooked,
  ]
    .map(csvEscape)
    .join(",");
  appendFileSync(AUTO_CSV, row + "\n", "utf8");

  if (!existsSync(AUTO_MD)) {
    writeFileSync(
      AUTO_MD,
      "# Auto change log (push notify)\n\nAppended by `scripts/quality/notify-push-change-log.mjs` on each main push.\n\n",
      "utf8"
    );
  }
  const md = [
    `## ${entry.dateTime} — \`${entry.version}\``,
    "",
    `- **Platform:** ${entry.platform}`,
    `- **What changed:** ${entry.what}`,
    `- **Why:** ${entry.why}`,
    `- **What affected:** ${entry.affected}`,
    `- **Criticality:** ${entry.criticality}`,
    `- **Impact / risks:** ${entry.impact}`,
    `- **Overlooked:** ${entry.overlooked}`,
    `- **Vercel:** ${entry.vercel}`,
    "",
  ].join("\n");
  appendFileSync(AUTO_MD, md, "utf8");
}

function isSmtpConfigured() {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim();
  if (!host || !from) return false;
  const local = host === "127.0.0.1" || host === "localhost";
  if (local) return process.platform !== "win32";
  return Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
}

async function sendMail({ to, subject, text }) {
  const host = process.env.SMTP_HOST.trim();
  const user = process.env.SMTP_USER?.trim() || "";
  const pass = process.env.SMTP_PASS?.trim() || "";
  const from = process.env.SMTP_FROM?.trim() || user;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const local = host === "127.0.0.1" || host === "localhost";

  const transport = nodemailer.createTransport(
    user && pass
      ? { host, port, secure, auth: { user, pass }, tls: { minVersion: "TLSv1.2" } }
      : {
          host,
          port: local ? 25 : port,
          secure: false,
          ignoreTLS: local,
          tls: { rejectUnauthorized: false },
        }
  );

  await transport.sendMail({ from, to, subject, text });
}

async function main() {
  loadEnvFiles();
  const args = parseArgs(process.argv);
  const { before, after } = resolveRange(args);
  const commits = listCommits(before, after);
  const files = filesChanged(before, after);
  const subjects = commits.map((c) => c.subject);
  const primary = commits[0] || {
    hash: after,
    short: (after || "").slice(0, 7),
    date: new Date().toISOString(),
    subject: "(no commits in range)",
  };

  const combinedSubject = subjects.length
    ? subjects.length === 1
      ? subjects[0]
      : `${subjects[0]} (+${subjects.length - 1} more)`
    : primary.subject;

  const analysis = analyze(combinedSubject + " " + subjects.join(" "), files);
  const vercel = await checkVercel(primary.hash || after);

  const impactParts = [...analysis.risks];
  if (vercel.ok === false) {
    impactParts.unshift(`Vercel deploy not Ready: ${vercel.detail}`);
  }
  const impact =
    impactParts.length > 0
      ? impactParts.join(" ")
      : "no evidence of breakage in this push range";

  const overlooked = [
    ...analysis.overlooked,
    vercel.detail ? `Vercel check: ${vercel.detail}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const dateTime = primary.date || new Date().toISOString();
  const entry = {
    dateTime,
    platform: analysis.platforms.join("+"),
    version: primary.short || (after || "").slice(0, 7),
    what: combinedSubject.replace(/\s+/g, " ").slice(0, 300),
    why: "git push notify (auto)",
    affected: analysis.affected,
    criticality:
      vercel.ok === false
        ? "HIGH"
        : analysis.criticality,
    impact,
    overlooked,
    vercel: vercel.detail,
  };

  appendLog(entry);

  const hasRisks =
    entry.criticality === "HIGH" ||
    analysis.risks.length > 0 ||
    vercel.ok === false ||
    analysis.overlooked.length > 0;

  const report = [
    "WRL Dashboard — push change log",
    "",
    `SHA: ${entry.version} (${primary.hash || after})`,
    `When: ${dateTime}`,
    `Platforms: ${entry.platform}`,
    `Criticality: ${entry.criticality}`,
    "",
    `What changed: ${entry.what}`,
    `What affected: ${entry.affected}`,
    "",
    "Risks / impact:",
    impact,
    "",
    "Overlooked / follow-ups:",
    overlooked || "(none)",
    "",
    `Files (${files.length}):`,
    ...files.slice(0, 40).map((f) => `  - ${f}`),
    files.length > 40 ? `  ... +${files.length - 40} more` : "",
    "",
    "Logged to artifacts/change-log-auto.md and change-log-auto.csv",
  ]
    .filter((l) => l !== "")
    .join("\n");

  console.log(report);

  const skipMail = process.env.CHANGELOG_SKIP_MAIL === "1";
  const always = process.env.CHANGELOG_MAIL_ALWAYS === "1";
  const to = process.env.CHANGELOG_MAIL_TO?.trim() || DEFAULT_TO;

  if (skipMail) {
    console.log("[changelog-notify] CHANGELOG_SKIP_MAIL=1 — skipped email");
    return;
  }
  if (!hasRisks && !always) {
    console.log("[changelog-notify] No HIGH/overlooked risks — skipped email (set CHANGELOG_MAIL_ALWAYS=1 to always send)");
    return;
  }
  if (!isSmtpConfigured()) {
    console.warn(
      "[changelog-notify] SMTP not configured — log written, email skipped. Set SMTP_* or .env.mis-email (GitHub: repo secrets)."
    );
    return;
  }

  const subject = `[WRL change-log ${entry.criticality}] ${entry.version} ${entry.what}`.slice(
    0,
    120
  );
  await sendMail({ to, subject, text: report });
  console.log(`[changelog-notify] Email sent to ${to}`);
}

main().catch((err) => {
  console.error("[changelog-notify] failed:", err);
  process.exitCode = 1;
});
