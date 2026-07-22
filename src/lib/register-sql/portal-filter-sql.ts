/**
 * SQL fragments for portal audit filters against calls_latest_hot (alias h).
 * CRM path uses parallel fragments with tc.ncode instead of h.ncode.
 */

const FLAGGED_TYPES = ['noted', 'escalate', 'query'] as const;

function parsePortalFilters(portalFilter: string): string[] {
  if (!portalFilter || portalFilter === 'All') return [];
  return portalFilter
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
}

function flagExistsSql(callIdExpr: string, flagType: string): string {
  return `EXISTS (SELECT 1 FROM call_flags f WHERE f.call_id = cast(${callIdExpr} AS text) AND f.flag_type = '${flagType}')`;
}

function hasCommentsSql(callIdExpr: string): string {
  return `EXISTS (SELECT 1 FROM call_comments c WHERE c.call_id = cast(${callIdExpr} AS text))`;
}

function unseenSql(callIdExpr: string): string {
  const flagged = FLAGGED_TYPES.map((t) => `'${t}'`).join(', ');
  return `NOT EXISTS (SELECT 1 FROM call_flags f WHERE f.call_id = cast(${callIdExpr} AS text) AND f.flag_type IN (${flagged}))`;
}

function filterToSql(filter: string, callIdExpr: string): string | null {
  switch (filter) {
    case 'verified':
      return flagExistsSql(callIdExpr, 'noted');
    case 'rejected':
      return flagExistsSql(callIdExpr, 'escalate');
    case 'hold':
      return flagExistsSql(callIdExpr, 'query');
    case 'comments':
      return hasCommentsSql(callIdExpr);
    case 'unseen':
      return unseenSql(callIdExpr);
    default:
      return null;
  }
}

/** Returns SQL AND clause for Postgres read model (h.ncode). */
export function buildPortalFilterSqlForHot(portalFilter: string): string | null {
  const filters = parsePortalFilters(portalFilter);
  if (!filters.length) return null;

  const parts = filters
    .map((f) => filterToSql(f, 'h.ncode'))
    .filter((sql): sql is string => sql != null);

  if (!parts.length) return null;
  return `(${parts.join(' OR ')})`;
}

/** Returns SQL AND fragment for CRM trhcalls queries (tc.ncode). */
export function buildPortalFilterSqlForCrm(portalFilter: string): string | null {
  const filters = parsePortalFilters(portalFilter);
  if (!filters.length) return null;

  const parts = filters
    .map((f) => filterToSql(f, 'tc.ncode'))
    .filter((sql): sql is string => sql != null);

  if (!parts.length) return null;
  return `(${parts.join(' OR ')})`;
}
