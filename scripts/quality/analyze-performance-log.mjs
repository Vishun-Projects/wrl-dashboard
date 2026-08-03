#!/usr/bin/env node
/**
 * Summarize JSONL performance logs written by /api/admin/performance-log.
 *
 * Usage:
 *   node scripts/quality/analyze-performance-log.mjs
 *   node scripts/quality/analyze-performance-log.mjs --date 2026-06-12
 *   node scripts/quality/analyze-performance-log.mjs --file logs/performance/metrics-2026-06-12.jsonl
 */

import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const fileArgIdx = args.indexOf('--file');
const dateArgIdx = args.indexOf('--date');

function resolveLogFile() {
  if (fileArgIdx >= 0 && args[fileArgIdx + 1]) {
    return path.resolve(args[fileArgIdx + 1]);
  }
  const date =
    dateArgIdx >= 0 && args[dateArgIdx + 1]
      ? args[dateArgIdx + 1]
      : new Date().toISOString().slice(0, 10);
  return path.join(process.cwd(), 'logs', 'performance', `metrics-${date}.jsonl`);
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function readEntries(file) {
  if (!fs.existsSync(file)) {
    console.error(`Log file not found: ${file}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  return lines.map((line, i) => {
    try {
      return JSON.parse(line);
    } catch {
      console.warn(`Skipping invalid JSON at line ${i + 1}`);
      return null;
    }
  }).filter(Boolean);
}

function main() {
  const file = resolveLogFile();
  const entries = readEntries(file);

  console.log(`\nPerformance log analysis`);
  console.log(`File: ${file}`);
  console.log(`Entries: ${entries.length}\n`);

  const byKind = new Map();
  const byRoute = new Map();
  const ttfb = [];
  const lcp = [];
  const inp = [];
  const slowResources = new Map();

  for (const entry of entries) {
    byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
    byRoute.set(entry.route, (byRoute.get(entry.route) ?? 0) + 1);

    for (const vital of entry.webVitals ?? []) {
      if (vital.name === 'TTFB') ttfb.push(vital.value);
      if (vital.name === 'LCP') lcp.push(vital.value);
      if (vital.name === 'INP') inp.push(vital.value);
    }

    const navTtfb = entry.navigationTiming?.ttfb;
    if (typeof navTtfb === 'number' && Number.isFinite(navTtfb)) ttfb.push(navTtfb);

    for (const res of entry.resourceSummary?.slowest ?? []) {
      const key = res.name.split('?')[0];
      const prev = slowResources.get(key) ?? { count: 0, maxDuration: 0 };
      slowResources.set(key, {
        count: prev.count + 1,
        maxDuration: Math.max(prev.maxDuration, res.duration),
      });
    }
  }

  console.log('By kind:');
  for (const [kind, count] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind}: ${count}`);
  }

  console.log('\nBy route (top 10):');
  for (const [route, count] of [...byRoute.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${route}: ${count}`);
  }

  const fmt = (v) => (v == null ? '—' : `${Math.round(v)} ms`);

  console.log('\nWeb Vitals / navigation TTFB (ms):');
  console.log(`  TTFB p50=${fmt(percentile(ttfb, 50))} p95=${fmt(percentile(ttfb, 95))} n=${ttfb.length}`);
  console.log(`  LCP  p50=${fmt(percentile(lcp, 50))} p95=${fmt(percentile(lcp, 95))} n=${lcp.length}`);
  console.log(`  INP  p50=${fmt(percentile(inp, 50))} p95=${fmt(percentile(inp, 95))} n=${inp.length}`);

  console.log('\nSlowest resources (by max duration seen):');
  const topResources = [...slowResources.entries()]
    .sort((a, b) => b[1].maxDuration - a[1].maxDuration)
    .slice(0, 12);
  for (const [name, stats] of topResources) {
    console.log(`  ${stats.maxDuration} ms (×${stats.count}) ${name}`);
  }

  console.log('');
}

main();
