import { config } from 'dotenv';
import { join } from 'path';

// Load env files
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env') });

// Explicitly use pooled database (port 6543) so connection from local dev PC succeeds
process.env.USE_DIRECT_DATABASE = 'false';

import { getAppPool, closePool } from '@/lib/read-model/db';

async function main() {
  const pool = getAppPool();
  console.log('=== 🐘 POSTGRES VPS PERFORMANCE DIAGNOSTICS ===');
  console.log('Connecting to database...');

  // 1. Basic Version & Connection Info
  try {
    const versionRes = await pool.query('SELECT version();');
    console.log(`\n[System Info]`);
    console.log(`Version: ${versionRes.rows[0].version}`);

    const connLimitRes = await pool.query('SHOW max_connections;');
    console.log(`Max Connections Limit: ${connLimitRes.rows[0].max_connections}`);

    const activeConnsRes = await pool.query(`
      SELECT state, count(*) as count 
      FROM pg_stat_activity 
      GROUP BY state 
      ORDER BY count DESC;
    `);
    console.log('Active Connections by State:');
    activeConnsRes.rows.forEach((row) => {
      console.log(`  - ${row.state || 'unknown'}: ${row.count}`);
    });
  } catch (err) {
    console.error('Failed to query system info:', err);
  }

  // 2. Cache Hit Rates (Target > 99%)
  try {
    console.log(`\n[Buffer Cache Hit Ratios]`);
    const cacheRes = await pool.query(`
      SELECT 
        sum(heap_blks_read) as heap_read,
        sum(heap_blks_hit)  as heap_hit,
        round((sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read) + 1e-9) * 100)::numeric, 2) as heap_hit_ratio,
        sum(idx_blks_read) as idx_read,
        sum(idx_blks_hit)  as idx_hit,
        round((sum(idx_blks_hit) / (sum(idx_blks_hit) + sum(idx_blks_read) + 1e-9) * 100)::numeric, 2) as idx_hit_ratio
      FROM pg_statio_user_tables;
    `);
    const stats = cacheRes.rows[0];
    console.log(`Table Buffer Hit Ratio: ${stats.heap_hit_ratio}% (read: ${stats.heap_read}, hit: ${stats.heap_hit})`);
    console.log(`Index Buffer Hit Ratio: ${stats.idx_hit_ratio}% (read: ${stats.idx_read}, hit: ${stats.idx_hit})`);
    if (parseFloat(stats.heap_hit_ratio) < 99.0) {
      console.log('⚠️ Warning: Table cache hit ratio is below 99%. shared_buffers might be set too low.');
    } else {
      console.log('✅ Excellent: Cache hit ratios are healthy.');
    }
  } catch (err) {
    console.error('Failed to query cache hit ratios:', err);
  }

  // 3. Table & Index Sizes (Relations)
  try {
    console.log(`\n[Top Tables & Index Sizes]`);
    const sizeRes = await pool.query(`
      SELECT
        relname AS table_name,
        pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
        pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
        pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) AS index_size,
        reltuples::bigint AS row_estimate
      FROM pg_class c
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT 15;
    `);
    console.table(sizeRes.rows);
  } catch (err) {
    console.error('Failed to query relation sizes:', err);
  }

  // 4. Missing Index Candidates (High Sequential Scans)
  try {
    console.log(`\n[Missing Index Candidates (High Seq Scans)]`);
    const missingRes = await pool.query(`
      SELECT
        relname AS table_name,
        seq_scan,
        seq_tup_read,
        idx_scan,
        idx_tup_fetch,
        seq_scan - idx_scan as scan_diff
      FROM pg_stat_user_tables
      WHERE (seq_scan + idx_scan) > 100
      ORDER BY scan_diff DESC, seq_scan DESC
      LIMIT 10;
    `);
    if (missingRes.rows.length === 0) {
      console.log('No tables found with high sequential scan ratios.');
    } else {
      console.table(missingRes.rows);
      console.log('💡 Note: Tables with high seq_scan and low idx_scan need indexes on columns used in WHERE/JOIN clauses.');
    }
  } catch (err) {
    console.error('Failed to query missing index candidates:', err);
  }

  // 5. Unused Indexes (Waste space and slow down writes)
  try {
    console.log(`\n[Unused Indexes (Candidates for Removal)]`);
    const unusedRes = await pool.query(`
      SELECT
        schemaname,
        relname AS table_name,
        indexrelname AS index_name,
        pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
        idx_scan
      FROM pg_stat_user_indexes ui
      JOIN pg_index i ON ui.indexrelid = i.indexrelid
      WHERE idx_scan = 0 AND indisunique = false AND schemaname = 'public'
      ORDER BY pg_relation_size(i.indexrelid) DESC
      LIMIT 10;
    `);
    if (unusedRes.rows.length === 0) {
      console.log('No unused non-unique indexes found.');
    } else {
      console.table(unusedRes.rows);
    }
  } catch (err) {
    console.error('Failed to query unused indexes:', err);
  }

  // 6. pg_stat_statements (Slowest Queries)
  try {
    console.log(`\n[Top 10 Slowest Queries (pg_stat_statements)]`);
    const statStatementsRes = await pool.query(`
      SELECT
        calls,
        round(total_exec_time::numeric, 2) as total_time_ms,
        round(mean_exec_time::numeric, 2) as mean_time_ms,
        substring(query from 1 for 120) as query_preview
      FROM pg_stat_statements
      ORDER BY total_exec_time DESC
      LIMIT 10;
    `);
    console.table(statStatementsRes.rows);
  } catch (_err) {
    console.log('ℹ️ pg_stat_statements extension is not loaded/enabled in the database, or you lack permissions.');
  }

  // 7. Autovacuum / Bloat Indicators
  try {
    console.log(`\n[Autovacuum & Dead Tuples]`);
    const vacuumRes = await pool.query(`
      SELECT 
        schemaname,
        relname as table_name,
        n_dead_tup,
        n_live_tup,
        round((n_dead_tup::numeric / (n_live_tup + n_dead_tup + 1e-9) * 100)::numeric, 2) as dead_ratio_pct,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY n_dead_tup DESC
      LIMIT 10;
    `);
    console.table(vacuumRes.rows);
    console.log('💡 Note: High dead tuple ratios (>20%) slow down scans. Ensure autovacuum is tuned or manually VACUUM ANALYZE.');
  } catch (err) {
    console.error('Failed to query autovacuum stats:', err);
  }

  console.log('\n=== DIAGNOSTICS COMPLETE ===');
}

main()
  .catch((err) => {
    console.error('Diagnostic error:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
