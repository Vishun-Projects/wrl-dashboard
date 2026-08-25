import { NextRequest, NextResponse } from 'next/server';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { resolveRequestUserId } from '@/lib/auth/server-user';
import { createClient } from '@/lib/supabase/server';
import { postQuery } from '@/lib/db/proxy';
import { buildRegisterCsvResponse } from './csv-export';
import { buildPostgresRegisterCsvStream } from './postgres-csv-export';
import { readRegisterFromPostgres } from '@/lib/read-model/flags';
import {
  queryRegisterBulkFromPostgres,
  queryRegisterFromPostgres,
  parseRegisterSortBy,
} from '@/sql/read-model/register';
import {
  appendCallTypeFilter,
  buildTrhcallsLookupCondition,
  buildTrhcallsLookupSubquery,
  enrichTrhcallBranchFranchisee,
  sqlFranchiseeCodeExpr,
  sqlFranchiseeNameExpr,
  buildFranchiseeFilterSqlCondition,
  resolveRegisterDateSqlColumn,
  sqlRegisterDateColumn,
  sqlRegisterDateColumnBare,
  buildRegisterRepairNcodeExistsWhere,
} from '@/sql/trhcalls/query';
import { enrichRegisterRowsRepairDone } from '@/sql/register/repair-done-enrich';
import { parseRepairQueryParam } from '@/modules/serial-audit';
import { resolveRegisterRepairCallKeys } from '@/modules/mis/register/server/repair-call-ncodes';
import { getPincodeMapData } from '@/lib/geo/pincode-map';
import { CITY_TO_STATE_MAP, getGeographicDetails } from '@/lib/geo/india-states';
import {
  isHodUser,
  resolveReportSecurity,
} from '@/lib/auth/report-security';
import { mergeBranchFilterListEntry } from '@/modules/mis';
import {
  enrichRegisterRowArcpApproveDates,
  REGISTER_ARCP_PICK_FIELDS_SQL,
  REGISTER_ARCP_PICK_OUTER_APPLY,
} from '@/sql/register/arcp-approve-dates';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';
import { mergeAuditEnrichment } from '@/sql/register/audit-enrichment';
import { buildPortalFilterSqlForCrm } from '@/sql/register/portal-filter-sql';
import { REGISTER_MSTPRORG_JOIN_SQL, SQL_WCO_EXPR } from '@/sql/register/wco';
import { logAccessDenied, logAction } from '@/lib/security/audit';
import { filterCorpusCallsByViewDate } from '@/modules/mis/services/corpus';
import { isIdentifierLookupSearch } from '@/modules/mis/services/search';



function appendStatusFilter(
  condition: string,
  statusFilter: string,
  isHod: boolean,
  visibleStatuses: string[],
  skipWhenSearch: boolean
): { condition: string; forbidden?: boolean } {
  if (skipWhenSearch) return { condition };

  const statuses =
    statusFilter && statusFilter !== 'All'
      ? statusFilter.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

  if (!isHod && visibleStatuses.length > 0) {
    if (statuses.length > 0) {
      const allowed = statuses.filter((s) => visibleStatuses.includes(s));
      if (allowed.length === 0) {
        return { condition, forbidden: true };
      }
      const statusConditions = allowed.map((s) => buildSingleStatusCondition(s).replace(/^ AND /, ''));
      return { condition: `${condition} AND (${statusConditions.join(' OR ')})` };
    }
    const statusConditions = visibleStatuses.map((s) => buildSingleStatusCondition(s).replace(/^ AND /, ''));
    return { condition: `${condition} AND (${statusConditions.join(' OR ')})` };
  }

  if (statuses.length > 0) {
    const statusConditions = statuses.map((s) => buildSingleStatusCondition(s).replace(/^ AND /, ''));
    return { condition: `${condition} AND (${statusConditions.join(' OR ')})` };
  }
  return { condition };
}

function buildSingleStatusCondition(statusFilter: string): string {
  const solvedStage =
    "((tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) OR (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1) OR (tc.callsolved = 'True' OR tc.callsolved = '1' OR tc.callsolved = 1))";
  if (statusFilter === 'Open Unallocated') {
    return ` AND (tc.nengineer = 0 OR tc.nengineer IS NULL OR CAST(tc.nengineer AS NVARCHAR(50)) = '0') AND NOT ${solvedStage} AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)`;
  }
  if (statusFilter === 'Assigned') {
    return ` AND (tc.nengineer > 0 OR (tc.nengineer IS NOT NULL AND CAST(tc.nengineer AS NVARCHAR(50)) <> '0')) AND NOT ${solvedStage} AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)`;
  }
  if (statusFilter === 'Tech. Solve Call') {
    return ` AND (tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) AND NOT (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1 OR tc.callsolved = 'True' OR tc.callsolved = '1' OR tc.callsolved = 1) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)`;
  }
  if (statusFilter === 'Closed') {
    return ` AND (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1 OR tc.callsolved = 'True' OR tc.callsolved = '1' OR tc.callsolved = 1) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0)`;
  }
  if (statusFilter === 'Cancelled') {
    return " AND (tc.ncancelreason IS NOT NULL AND tc.ncancelreason <> 0 AND tc.ncancelreason <> 2)";
  }
  return '';
}

function applyPortalFilter(condition: string, portalFilter: string | null): string {
  const portalSql = buildPortalFilterSqlForCrm(portalFilter || '');
  if (!portalSql) return condition;
  return `${condition} AND ${portalSql}`;
}

function mapCrmRegisterRow(row: Record<string, unknown>): Record<string, unknown> {
  const geo = getGeographicDetails(
    String(row.Pincode ?? ''),
    String(row.dbCity ?? ''),
    String(row.dbState ?? '')
  );
  return enrichRegisterRowArcpApproveDates(
    enrichTrhcallBranchFranchisee({
      ...row,
      state: geo.state,
      city: geo.city,
      technician_name: row.serviceman || 'UNKNOWN',
    })
  );
}

function parseFilterList(val: string | undefined): string[] {
  if (!val || val === 'All') return [];
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

function matchesFilterList(value: string, filterVal: string | undefined): boolean {
  const list = parseFilterList(filterVal);
  if (list.length === 0) return true;
  return list.includes(value);
}

type CsrFilterRow = {
  state?: string;
  city?: string;
  nofficeid?: string | number;
  franchisee_code?: string;
  nengineer?: string | number;
};

type CsrFilterCriteria = {
  state?: string;
  city?: string;
  branch?: string;
  franchisee?: string;
  technician?: string;
};

function filterCallsCSR<T extends CsrFilterRow>(
  calls: T[],
  criteria: CsrFilterCriteria,
  exclude?: string
) {
  return calls.filter((c) => {
    if (exclude !== 'state' && criteria.state && criteria.state !== 'All') {
      if (!matchesFilterList(c.state ?? '', criteria.state)) return false;
    }
    if (exclude !== 'city' && criteria.city && criteria.city !== 'All') {
      if (!matchesFilterList(c.city ?? '', criteria.city)) return false;
    }
    if (exclude !== 'branch' && criteria.branch && criteria.branch !== 'All') {
      if (!matchesFilterList(String(c.nofficeid), criteria.branch)) return false;
    }
    if (exclude !== 'franchisee' && criteria.franchisee && criteria.franchisee !== 'All') {
      if (!matchesFilterList(c.franchisee_code ?? '', criteria.franchisee)) return false;
    }
    if (exclude !== 'technician' && criteria.technician && criteria.technician !== 'All') {
      if (!matchesFilterList(String(c.nengineer), criteria.technician)) return false;
    }
    return true;
  });
}

export async function handleRegisterGet(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    /** CRM viewstate OOMs on large OFFSET/FETCH windows — cap page size on the SQL Server path. */
    const CRM_MAX_PAGE_SIZE = 1000;
    const search = searchParams.get('search') || '';
    const officeId = searchParams.get('officeId') || 'All';
    const callType = searchParams.get('callType');
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';
    const dateFilterColumnParam = searchParams.get('dateFilterColumn') || 'dtrndate';
    const account = searchParams.get('account') || '';
    const region = searchParams.get('region') || '';
    const status = searchParams.get('status') || '';
    const pincode = searchParams.get('pincode') || '';
    const lastSync = searchParams.get('lastSync') || '';
    const priority = searchParams.get('priority') || 'all';
    const portalFilter = searchParams.get('portalFilter') || 'All';
    const repair = searchParams.get('repair') || 'All';
    const repairNcodes = parseRepairQueryParam(repair);
    const sortBy = parseRegisterSortBy(searchParams.get('sortBy'));
    const sortDir: 'asc' | 'desc' = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';

    // Cascading filters
    const state = searchParams.get('state') || '';
    const city = searchParams.get('city') || '';
    const branch = searchParams.get('branch') || '';
    const franchisee = searchParams.get('franchisee') || '';
    const technician = searchParams.get('technician') || '';

    const supabase = await createClient();
    const userId = await resolveRequestUserId(req, supabase);
    if (!userId) {
      await logAccessDenied({ request: req, statusCode: 401, reason: 'register_unauthorized' });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    
    
    const acceptEncoding = req.headers.get('accept-encoding');
    const security = await resolveReportSecurity(userId, {
      pageId: 'mis_reports',
      tabId: 'register',
    });
    if (security.forbidden) {
      await logAccessDenied({
        request: req,
        actorUserId: userId,
        statusCode: 403,
        reason: 'register_forbidden',
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const auth = await loadUserAuth(userId);
    const permissions = auth?.permissions ?? [];
    const profile = auth?.profile;

    const assignedOffices = profile?.office_ids || [];
    const visibleStatuses = profile?.visible_statuses || [];

    const isHod = isHodUser(profile ?? undefined, permissions);

    // Repair done: lean CRM id list → filter Postgres hot (avoid full CRM register grid timeout).
    if (readRegisterFromPostgres() && !lastSync) {
      const registerDateCol = resolveRegisterDateSqlColumn(dateFilterColumnParam);
      let repairCallKeys: Array<{ ncode: number; officeId: number }> | undefined;
      if (repairNcodes.length > 0) {
        repairCallKeys = await resolveRegisterRepairCallKeys({
          repair,
          startDate,
          endDate,
          dateFilterColumn: registerDateCol,
          isHod,
          assignedOffices,
          officeId,
        });
        if (!repairCallKeys?.length) {
          return NextResponse.json({
            data: [],
            total: 0,
            summary: {
              total: 0,
              cancelled: 0,
              solved: 0,
              open: 0,
              openUnallocated: 0,
              assigned: 0,
              techSolved: 0,
              closed: 0,
            },
          });
        }
      }

      if (searchParams.get('export') === 'bulk') {
        const payload = await queryRegisterBulkFromPostgres({
          officeId,
          callType: callType ?? null,
          startDate,
          endDate,
          dateFilterColumn: registerDateCol,
          assignedOffices,
          visibleStatuses,
          isHod,
          repairCallKeys,
        });
        return NextResponse.json(payload);
      }

      if (searchParams.get('export') === 'csv') {
        const exportActor = {
          userId,
          email: profile?.email ?? null,
          name: profile?.name ?? null,
        };
        const exportMeta = {
          startDate,
          endDate,
          dateFilterColumn: registerDateCol,
          status,
          callType,
          officeId,
        };
        await logAction({
          request: req,
          action: 'report.export.start',
          actor: exportActor,
          result: 'started',
          statusCode: 202,
          target: { type: 'register_csv_export' },
          summary: 'Started Call Register CSV export',
          metadata: exportMeta,
        });
        return buildPostgresRegisterCsvStream({
          search,
          officeId,
          callType: callType ?? null,
          startDate,
          endDate,
          dateFilterColumn: registerDateCol,
          status,
          account,
          region,
          pincode,
          priority,
          portalFilter,
          state,
          city,
          branch,
          franchisee,
          technician,
          assignedOffices,
          visibleStatuses,
          isHod,
          repairCallKeys,
          acceptEncoding,
          audit: { request: req, actor: exportActor, metadata: exportMeta },
        });
      }

      const postgresListParams = {
        page,
        limit,
        search,
        officeId,
        callType: callType ?? null,
        startDate,
        endDate,
        dateFilterColumn: registerDateCol,
        status,
        account,
        region,
        pincode,
        priority,
        portalFilter,
        state,
        city,
        branch,
        franchisee,
        technician,
        fetchTotals: searchParams.get('fetchTotals') !== 'false',
        fetchFilterOptions: searchParams.get('fetchFilterOptions') !== 'false',
        assignedOffices,
        visibleStatuses,
        isHod,
        repairCallKeys,
        cursorLoggedAt: (() => {
          const raw = searchParams.get('cursorLoggedAt');
          return raw && raw.trim() ? raw.trim() : undefined;
        })(),
        cursorNcode: (() => {
          const raw = searchParams.get('cursorNcode');
          const parsed = raw ? parseInt(raw, 10) : NaN;
          return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
        })(),
        sortBy,
        sortDir,
      };

      let payload = await queryRegisterFromPostgres(postgresListParams);

      const idLookup = !!(search && search.trim()) && isIdentifierLookupSearch(search);
      if (idLookup && !(payload.data as unknown[] | undefined)?.length && (startDate || endDate)) {
        const wide = await queryRegisterFromPostgres({
          ...postgresListParams,
          startDate: '',
          endDate: '',
          fetchTotals: false,
          fetchFilterOptions: false,
          page: 1,
        });
        const matched = filterCorpusCallsByViewDate(
          (wide.data || []) as Record<string, unknown>[],
          {
            viewStartDate: startDate,
            viewEndDate: endDate,
            dateFilterColumn: registerDateCol,
          }
        );
        if (matched.length) {
          payload = { ...payload, data: matched, total: matched.length };
        }
      }

      if (!idLookup || (payload.data as unknown[] | undefined)?.length) {
        return NextResponse.json(payload);
      }
      // Identifier not in Postgres read-model — fall through to CRM lookup subquery.
    }

    // Live CRM path (READ_REGISTER_FROM != postgres, or Postgres identifier lookup miss)
    const excludeTransferred = " AND ISNULL(tc.vtransfercallno, '') = '' AND ISNULL(tc.ncancelreason, 0) <> 2";
    const isLookupSearch = !!(search && search.trim());
    const registerDateCol = resolveRegisterDateSqlColumn(dateFilterColumnParam);
    const registerDateSql = sqlRegisterDateColumn(registerDateCol);
    const registerDateBare = sqlRegisterDateColumnBare(registerDateCol);
    const bmPredAliased =
      registerDateCol === 'bm_approved_at' ? ` AND (ISNULL(tc.bapproval, '0') IN ('1', 'True', 'true'))` : '';
    const bmPredBare =
      registerDateCol === 'bm_approved_at' ? ` AND (ISNULL(bapproval, '0') IN ('1', 'True', 'true'))` : '';
    const cancelPredAliased =
      registerDateCol === 'cancelled_at' ? ` AND ISNULL(tc.ncancelreason, 0) NOT IN (0, 2)` : '';
    const cancelPredBare =
      registerDateCol === 'cancelled_at' ? ` AND ISNULL(ncancelreason, 0) NOT IN (0, 2)` : '';

    let baseCondition: string;
    if (isLookupSearch) {
      baseCondition = buildTrhcallsLookupCondition(search);
      baseCondition += bmPredAliased;
      baseCondition += cancelPredAliased;
      if (startDate) {
        baseCondition += ` AND ${registerDateSql} >= '${startDate.replace(/'/g, "''")}'`;
      }
      if (endDate) {
        baseCondition += ` AND ${registerDateSql} <= '${endDate.replace(/'/g, "''")} 23:59:59'`;
      }
    } else {
      baseCondition = `(tc.vtrnno IS NOT NULL AND tc.vtrnno <> '')${excludeTransferred}`;
    }

    if (!isLookupSearch) {
      let dbSecurityCondition = '';
      if (!isHod && assignedOffices.length > 0) {
        const allowed = assignedOffices.join(',');
        dbSecurityCondition = ` AND (tc.nofficeid IN (${allowed}) OR o.nunder IN (${allowed}))`;
      }

      if (officeId && officeId !== 'All' && officeId !== 'undefined' && officeId !== 'null') {
        if (officeId.includes(',')) {
          baseCondition += ` AND tc.nofficeid IN (${officeId})`;
        } else {
          baseCondition += ` AND tc.nofficeid = ${officeId}`;
        }
      }
      
      baseCondition += dbSecurityCondition;

      if (startDate) {
        baseCondition += ` AND ${registerDateSql} >= '${startDate}'`;
      }
      if (endDate) {
        baseCondition += ` AND ${registerDateSql} <= '${endDate} 23:59:59'`;
      }

      if (account && account !== 'All' && account !== 'undefined' && account !== 'null') {
        const accountNameSafe = account.replace(/'/g, "''");
        baseCondition += ` AND tc.npartyprofile IN (SELECT ncode FROM mstpartyprofile WHERE vname LIKE '%${accountNameSafe}%')`;
      }

      if (callType && callType !== 'All' && callType !== 'undefined' && callType !== 'null') {
        baseCondition = appendCallTypeFilter(baseCondition, callType);
      }

      if (region && region !== 'All') {
        const regionsArray = region.split(',').map(r => `'${r.replace(/'/g, "''")}'`).join(',');
        baseCondition += ` AND tc.nofficeid IN (
          SELECT o.ncode FROM mstoffice o
          LEFT JOIN mstoffice op ON o.nunder = op.ncode AND o.nunder <> 0
          LEFT JOIN mstzones z ON (CASE WHEN ISNULL(o.nunder, 0) = 0 THEN o.nzone ELSE op.nzone END) = z.ncode
          WHERE z.vname IN (${regionsArray})
        )`;
      }

      const statusResult = appendStatusFilter(baseCondition, status, isHod, visibleStatuses, false);
      if (statusResult.forbidden) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      baseCondition = statusResult.condition;

      if (priority && priority !== 'all') {
        const priorities = priority.split(',').map((p) => p.trim()).filter((p) => p && p !== 'all');
        if (priorities.length === 1) {
          if (priorities[0] === 'major') {
            baseCondition += " AND EXISTS (SELECT 1 FROM trdcalls2fault tf (NOLOCK) JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid AND r.bmajor = 'True')";
          } else if (priorities[0] === 'minor') {
            baseCondition += " AND NOT EXISTS (SELECT 1 FROM trdcalls2fault tf (NOLOCK) JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid AND r.bmajor = 'True')";
          }
        }
      }

      const repairWhere = buildRegisterRepairNcodeExistsWhere(repair, 'tc');
      if (repairWhere) {
        baseCondition += ` AND ${repairWhere}`;
      }

      if (pincode) {
        const pincodeSafe = pincode.replace(/'/g, "''");
        baseCondition += ` AND p.vinstpostalcode LIKE '%${pincodeSafe}%'`;
      }
    }

    if (lastSync) {
      baseCondition += ` AND ISNULL(tc.editedon, tc.addedon) >= '${lastSync.replace(/'/g, "''")}'`;
    }

    let condition = applyPortalFilter(baseCondition, isLookupSearch ? 'All' : portalFilter);

    // Helper functions to find pincodes mapped in JSON
    const getPincodesForState = (stateName: string): string[] => {
      const normalizedState = stateName.toUpperCase().trim();
      const pins: string[] = [];
      for (const [pin, val] of Object.entries(getPincodeMapData())) {
        if (val.s && val.s.toUpperCase().trim() === normalizedState) {
          pins.push(pin);
        }
      }
      return pins;
    };

    const getPincodesForCity = (cityName: string): string[] => {
      const normalizedCity = cityName.toUpperCase().trim();
      const pins: string[] = [];
      for (const [pin, val] of Object.entries(getPincodeMapData())) {
        if (val.d && val.d.toUpperCase().trim() === normalizedCity) {
          pins.push(pin);
        }
      }
      return pins;
    };

    const buildSingleStateCondition = (stateName: string): string => {
      const stateSafe = stateName.replace(/'/g, "''");
      const mappedCities = Object.entries(CITY_TO_STATE_MAP)
        .filter(([, state]) => state.toUpperCase() === stateName.toUpperCase())
        .map(([city]) => city.replace(/'/g, "''"));

      const statePincodes = getPincodesForState(stateName);

      let stateCond = `(st.vname = '${stateSafe}'`;
      if (mappedCities.length > 0) {
        stateCond += ` OR cty.vname IN (${mappedCities.map((c) => `'${c}'`).join(',')})`;
      }
      stateCond += ')';

      if (statePincodes.length > 0) {
        const pinsList = statePincodes.map((p) => `'${p}'`).join(',');
        return `(
          ${stateCond}
          OR (
            (st.vname IS NULL OR st.vname = '' OR st.vname = 'NA' OR st.vname = 'N/A' OR st.vname = 'UNKNOWN')
            AND p.vinstpostalcode IN (${pinsList})
          )
        )`;
      }
      return stateCond;
    };

    const buildSingleCityCondition = (cityName: string): string => {
      const citySafe = cityName.replace(/'/g, "''");
      const cityPincodes = getPincodesForCity(cityName);
      if (cityPincodes.length > 0) {
        const pinsList = cityPincodes.map((p) => `'${p}'`).join(',');
        return `(
          (cty.vname = '${citySafe}')
          OR (
            (cty.vname IS NULL OR cty.vname = '' OR cty.vname = 'NA' OR cty.vname = 'N/A' OR cty.vname = 'UNKNOWN')
            AND p.vinstpostalcode IN (${pinsList})
          )
        )`;
      }
      return `(cty.vname = '${citySafe}')`;
    };

    if (!isLookupSearch && state && state !== 'All') {
      const states = state.split(',').map((s) => s.trim()).filter(Boolean);
      if (states.length === 1) {
        condition += ` AND ${buildSingleStateCondition(states[0])}`;
      } else if (states.length > 1) {
        condition += ` AND (${states.map((s) => buildSingleStateCondition(s)).join(' OR ')})`;
      }
    }

    if (!isLookupSearch && city && city !== 'All') {
      const cities = city.split(',').map((c) => c.trim()).filter(Boolean);
      if (cities.length === 1) {
        condition += ` AND ${buildSingleCityCondition(cities[0])}`;
      } else if (cities.length > 1) {
        condition += ` AND (${cities.map((c) => buildSingleCityCondition(c)).join(' OR ')})`;
      }
    }

    if (!isLookupSearch && branch && branch !== 'All') {
      const branches = branch.split(',').map((b) => b.trim()).filter(Boolean);
      if (branches.length === 1) {
        const branchSafe = branches[0].replace(/'/g, "''");
        condition += ` AND (tc.nofficeid = '${branchSafe}' OR o.nunder = '${branchSafe}')`;
      } else if (branches.length > 1) {
        const branchList = branches.map((b) => `'${b.replace(/'/g, "''")}'`).join(',');
        condition += ` AND (tc.nofficeid IN (${branchList}) OR o.nunder IN (${branchList}))`;
      }
    }

    if (!isLookupSearch && franchisee && franchisee !== 'All') {
      condition += buildFranchiseeFilterSqlCondition(franchisee);
    }

    if (!isLookupSearch && technician && technician !== 'All') {
      const techs = technician.split(',').map((t) => t.trim()).filter(Boolean);
      if (techs.length === 1) {
        const technicianSafe = techs[0].replace(/'/g, "''");
        condition += ` AND tc.nengineer = '${technicianSafe}'`;
      } else if (techs.length > 1) {
        condition += ` AND tc.nengineer IN (${techs.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')})`;
      }
    }

    // Direct table join matching the Calls register exactly
    const fields = `
      tc.vcclid as vcclid,
      CONVERT(varchar(30), tc.dtrndate, 126) as callsdtrndate,
      p.vname as PartyName,
      p.vinstpostalcode as Pincode,
      cty.vname as dbCity,
      st.vname as dbState,
      tc.ntransfertooffice as ntransfertooffice,
      ${sqlFranchiseeCodeExpr()} as franchisee_code,
      tc.vlocation as vlocation,
      mstitems.vitemcode as itemcode,
      mstitems.vname as itemname,
      tc.vserialno as callsvserialno,
      ${SQL_WCO_EXPR} as WCO,
      u.vname as serviceman,
      f.vcompanyname as technician_office_name,
      f.ncode as technician_office_id,
      transferoffice.vcompanyname as transfer_office_name,
      tc.vcomplaint as vcomplaint,
      tc.callStatus as Status,
      case
        when tc.ncancelreason is not null and tc.ncancelreason <> 0 and tc.ncancelreason <> 2 then 'Cancel'
        when (tc.bsolved in ('True','true','1') or tc.bsolved = 1) then 'Closed'
        when (tc.bfastclose in ('True','true','1') or tc.bfastclose = 1) then 'TechSolved'
        else 'Open'
      end as callstatus,
      tc.bsolved as callsolved,
      priority_fs.vdisplayvalue as Priority,
      CONVERT(varchar(30), tc.dsolvedatetime, 126) as callsolveddate,
      tc.vsolveremarks as vsolveremarks,
      tc.vtrnno as UniqueCallNo,
      tc.ncode as id,
      tc.vpersoncalling as vpersoncalling,
      p.vinsttel1 as vinsttel1,
      p.vinstaddress as vinstaddress,
      tc.addedby as addedby,
      o.vcompanyname as office_name,
      o.nunder as office_under,
      bo.vcompanyname as branch_office_name,
      ${sqlFranchiseeNameExpr()} as franchisee_name,
      calltype_fs.vdisplayvalue as calltype,
      tc.vtransfercallno as vtransfercallno,
      tc.bfastclose as bfastclose,
      tc.nengineer as nengineer,
      tc.nofficeid as nofficeid,
      case when isnull(tc.bBMreject,0)=1 and isnull(tc.bhoreject,0)=0 then 'Yes' else 'No' end as bmreject,
      case when isnull(tc.bhoreject,0)=1 and isnull(tc.bhounreject,0)=0 then 'Yes' else 'No' end as horeject,
      case when isnull(tc.bhoreject,0)=1 and isnull(tc.bhounreject,0)=0 then 2 else case when isnull(tc.bBMreject,0)=1 and isnull(tc.bhoreject,0)=0 then 1 end end as rejectionstatus,
      tc.vcomment as vcomment,
      tc.vBMrejectreason as vBMrejectreason,
      cr.vname as cancel_reason,
      (SELECT TOP 1 r.bmajor FROM trdcalls2fault tf (NOLOCK) JOIN mstrepair r (NOLOCK) ON tf.nrepair = r.ncode WHERE tf.ncalls = tc.ncode AND tf.nofficeid = tc.nofficeid ORDER BY CASE WHEN r.bmajor = 'True' THEN 1 ELSE 2 END) as is_major_repair,
      ${REGISTER_ARCP_PICK_FIELDS_SQL.trim()}
    `;

    let subqueryCondition = "";
    if (lastSync) {
      subqueryCondition = `WHERE ISNULL(editedon, addedon) >= '${lastSync.replace(/'/g, "''")}'`;
      subqueryCondition += bmPredBare;
      subqueryCondition += cancelPredBare;
      if (startDate) {
        subqueryCondition += ` AND ${registerDateBare} >= '${startDate.replace(/'/g, "''")}'`;
      }
    } else if (!isLookupSearch && (startDate || endDate)) {
      const dateParts: string[] = [];
      if (registerDateCol === 'bm_approved_at') {
        dateParts.push(`ISNULL(bapproval, '0') IN ('1', 'True', 'true')`);
      }
      if (registerDateCol === 'cancelled_at') {
        dateParts.push(`ISNULL(ncancelreason, 0) NOT IN (0, 2)`);
      }
      if (startDate) dateParts.push(`${registerDateBare} >= '${startDate.replace(/'/g, "''")}'`);
      if (endDate) dateParts.push(`${registerDateBare} <= '${endDate.replace(/'/g, "''")} 23:59:59'`);
      subqueryCondition = `WHERE ${dateParts.join(' AND ')}`;
    }

    const LATEST_CALLS_SUBQUERY =
      isLookupSearch && !lastSync
        ? buildTrhcallsLookupSubquery(search, {
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            dateFilterColumn: registerDateCol,
          })
        : `(
      SELECT *
      FROM (
        SELECT *,
                ROW_NUMBER() OVER (
                  PARTITION BY CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END
                  ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC
                ) as rn
        FROM trhcalls (NOLOCK)
        ${subqueryCondition}
      ) s
      WHERE s.rn = 1
    ) tc`;


    const tableName = `
      ${LATEST_CALLS_SUBQUERY}
      LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
      LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
      LEFT JOIN mstoffice bo (NOLOCK) ON o.nunder = bo.ncode
      LEFT JOIN mstcity cty (NOLOCK) ON COALESCE(NULLIF(p.ncity, ''), o.ncity) = cty.ncode
      LEFT JOIN mststate st (NOLOCK) ON cty.nstate = st.ncode
      LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode
      LEFT JOIN mstoffice f (NOLOCK) ON u.nofficeid = f.ncode
      LEFT JOIN mstcallcancelreasons cr (NOLOCK) ON tc.ncancelreason = cr.ncode
      LEFT JOIN mstitems (NOLOCK) ON tc.nitem = mstitems.ncode
      LEFT JOIN mstfixedselection calltype_fs (NOLOCK) ON tc.ncalltype = calltype_fs.ncode AND calltype_fs.vfieldname = 'ncalltype'
      LEFT JOIN mstfixedselection priority_fs (NOLOCK) ON tc.npriority = priority_fs.ncode AND priority_fs.vfieldname = 'npriority'
      LEFT JOIN mstoffice transferoffice (NOLOCK) ON tc.ntransfertooffice = transferoffice.ncode
      ${REGISTER_MSTPRORG_JOIN_SQL}
      ${REGISTER_ARCP_PICK_OUTER_APPLY}
    `;

    if (lastSync) {
      const res = await postQuery({
        fields,
        tableName,
        condition,
        orderBy: "tc.ncode DESC" // Order by recently edited/added
      });

      const processedData = await enrichRegisterRowsRepairDone(
        await mergeAuditEnrichment(
          (res.data || []).map((row: Record<string, unknown>) => mapCrmRegisterRow(row))
        )
      );

      return NextResponse.json({
        data: processedData,
        isDelta: true,
      });
    }

    if (searchParams.get('export') === 'csv') {
      const exportActor = {
        userId,
        email: profile?.email ?? null,
        name: profile?.name ?? null,
      };
      const exportMeta = {
        startDate,
        endDate,
        dateFilterColumn: registerDateCol,
        status,
        callType,
        officeId,
      };
      await logAction({
        request: req,
        action: 'report.export.start',
        actor: exportActor,
        result: 'started',
        statusCode: 202,
        target: { type: 'register_csv_export' },
        summary: 'Started Call Register CSV export',
        metadata: exportMeta,
      });
      return buildRegisterCsvResponse({
        fields,
        tableName,
        condition,
        batchSize: Math.min(Math.max(parseInt(searchParams.get('batchSize') || '1000', 10) || 1000, 1), 1000),
        knownTotal: parseInt(searchParams.get('knownTotal') || '0', 10) || 0,
        acceptEncoding,
        processRows: async (rows) =>
          enrichRegisterRowsRepairDone(
            await mergeAuditEnrichment(
              rows.map((row: Record<string, unknown>) => mapCrmRegisterRow(row))
            )
          ),
        onComplete: async ({ filename, rowCount }) => {
          await logAction({
            request: req,
            action: 'report.export.complete',
            actor: exportActor,
            result: 'completed',
            statusCode: 200,
            target: { type: 'register_csv_export', label: filename },
            summary: `Exported Call Register CSV (${rowCount.toLocaleString()} rows)`,
            metadata: { ...exportMeta, rowCount },
          });
        },
        onFailure: async ({ filename, rowCount, reason, message }) => {
          await logAction({
            request: req,
            action: reason === 'aborted' ? 'report.export.cancelled' : 'report.export.failure',
            actor: exportActor,
            result: reason === 'aborted' ? 'cancelled' : 'failure',
            statusCode: reason === 'aborted' ? 499 : 500,
            target: { type: 'register_csv_export', label: filename },
            summary:
              reason === 'aborted'
                ? 'Call Register CSV export cancelled'
                : 'Call Register CSV export failed',
            metadata: {
              ...exportMeta,
              rowCount,
              ...(reason === 'aborted' ? { reason: 'client_aborted' } : {}),
              ...(message ? { message } : {}),
            },
          });
        },
      });
    }

    const notCancelledSql =
      '(tc.ncancelreason IS NULL OR tc.ncancelreason = 0 OR tc.ncancelreason = 2)';

    const fetchTotals = searchParams.get('fetchTotals') !== 'false'; // default true
    const fetchFilterOptions = searchParams.get('fetchFilterOptions') !== 'false';
    const effectiveLimit = Math.min(Math.max(limit, 1), CRM_MAX_PAGE_SIZE);
    const cursorRaw = searchParams.get('cursorNcode');
    const cursorNcode = cursorRaw ? parseInt(cursorRaw, 10) : NaN;
    const useKeysetCursor = Number.isFinite(cursorNcode) && cursorNcode > 0;
    const dataCondition = useKeysetCursor ? `${condition} AND tc.ncode < ${cursorNcode}` : condition;
    const offset = useKeysetCursor ? 0 : (page - 1) * effectiveLimit;

    let summaryRes: { data: Array<Record<string, string | number>> } = {
      data: [{
        total: 0,
        cancelled: 0,
        solved: 0,
        open_calls: 0,
        open_unallocated: 0,
        assigned: 0,
        tech_solved: 0,
        closed: 0,
      }],
    };
    let filterOptionsRes: { data: Array<Record<string, string>> } = { data: [] };
    let res!: { data: Array<Record<string, string>> };

    const dataQuery = postQuery({
      fields,
      tableName,
      condition: dataCondition,
      orderBy: `tc.ncode DESC OFFSET ${offset} ROWS FETCH NEXT ${effectiveLimit} ROWS ONLY`
    });

    if (fetchTotals) {
      const summaryQuery = postQuery({
        fields: `
            COUNT(*) as total,
            SUM(CASE WHEN tc.ncancelreason IS NOT NULL AND tc.ncancelreason <> 0 AND tc.ncancelreason <> 2 THEN 1 ELSE 0 END) as cancelled,
            SUM(CASE WHEN ${notCancelledSql} AND (((tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) OR (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1) OR (tc.callsolved = 'True' OR tc.callsolved = '1' OR tc.callsolved = 1))) THEN 1 ELSE 0 END) as solved,
            SUM(CASE WHEN NOT (((tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) OR (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1) OR (tc.callsolved = 'True' OR tc.callsolved = '1' OR tc.callsolved = 1))) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as open_calls,
            SUM(CASE WHEN (tc.nengineer = 0 OR tc.nengineer IS NULL OR CAST(tc.nengineer AS NVARCHAR(50)) = '0') AND NOT (((tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) OR (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1) OR (tc.callsolved = 'True' OR tc.callsolved = '1' OR tc.callsolved = 1))) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as open_unallocated,
            SUM(CASE WHEN (tc.nengineer > 0 OR (tc.nengineer IS NOT NULL AND CAST(tc.nengineer AS NVARCHAR(50)) <> '0')) AND NOT (((tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) OR (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1) OR (tc.callsolved = 'True' OR tc.callsolved = '1' OR tc.callsolved = 1))) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as assigned,
            SUM(CASE WHEN (tc.bfastclose = 'True' OR tc.bfastclose = '1' OR tc.bfastclose = 1) AND NOT (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1 OR tc.callsolved = 'True' OR tc.callsolved = '1' OR tc.callsolved = 1) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as tech_solved,
            SUM(CASE WHEN (tc.bsolved = 'True' OR tc.bsolved = '1' OR tc.bsolved = 1 OR tc.callsolved = 'True' OR tc.callsolved = '1' OR tc.callsolved = 1) AND (tc.ncancelreason IS NULL OR tc.ncancelreason = 0) THEN 1 ELSE 0 END) as closed
          `,
        tableName,
        condition,
      });

      if (fetchFilterOptions) {
        const optionsQuery = postQuery({
          rawSql: `
          SELECT
            tc.nofficeid,
            o.vcompanyname as office_name,
            o.nunder as office_under,
            bo.vcompanyname as branch_office_name,
            ${sqlFranchiseeCodeExpr()} as franchisee_code,
            ${sqlFranchiseeNameExpr()} as franchisee_name,
            tc.nengineer,
            u.vname as technician_name,
            p.vinstpostalcode as Pincode,
            cty.vname as dbCity,
            st.vname as dbState,
            COUNT(*) as call_count
          FROM ${tableName}
          WHERE ${baseCondition}
          GROUP BY
            tc.nofficeid,
            o.vcompanyname,
            o.nunder,
            bo.vcompanyname,
            ${sqlFranchiseeCodeExpr()},
            ${sqlFranchiseeNameExpr()},
            tc.nengineer,
            u.vname,
            p.vinstpostalcode,
            cty.vname,
            st.vname
        `,
        });

        [res, summaryRes, filterOptionsRes] = (await Promise.all([
          dataQuery,
          summaryQuery,
          optionsQuery,
        ])) as [typeof res, typeof summaryRes, typeof filterOptionsRes];
      } else {
        [res, summaryRes] = (await Promise.all([dataQuery, summaryQuery])) as [
          typeof res,
          typeof summaryRes,
        ];
      }
    } else {
      res = (await dataQuery) as typeof res;
    }

    const summary = summaryRes.data?.[0] || {
      total: 0,
      cancelled: 0,
      solved: 0,
      open_calls: 0,
      open_unallocated: 0,
      assigned: 0,
      tech_solved: 0,
      closed: 0,
    };
    const totalCount = parseInt(String(summary.total || "0"));

    const processedData = await enrichRegisterRowsRepairDone(
      await mergeAuditEnrichment(
        (res.data || []).map((row: Record<string, unknown>) => mapCrmRegisterRow(row))
      )
    );

    const responsePayload: Record<string, unknown> = {
      data: processedData,
    };

    if (fetchTotals) {
      responsePayload.total = totalCount;
      responsePayload.summary = {
        total: parseInt(String(summary.total || "0")),
        cancelled: parseInt(String(summary.cancelled || "0")),
        solved: parseInt(String(summary.solved || "0")),
        open: parseInt(String(summary.open_calls || "0")),
        openUnallocated: parseInt(String(summary.open_unallocated || "0")),
        assigned: parseInt(String(summary.assigned || "0")),
        techSolved: parseInt(String(summary.tech_solved || "0")),
        closed: parseInt(String(summary.closed || "0")),
      };

      if (fetchFilterOptions) {
      // Process options
      const rawOptions = filterOptionsRes.data || [];
      const processedOptions = rawOptions.map((row) => {
        const geo = getGeographicDetails(row.Pincode, row.dbCity, row.dbState);
        return enrichTrhcallBranchFranchisee({
          state: geo.state,
          city: geo.city,
          nofficeid: row.nofficeid ? String(row.nofficeid) : 'UNKNOWN',
          office_name: row.office_name,
          office_under: row.office_under,
          branch_office_name: row.branch_office_name,
          franchisee_code: row.franchisee_code,
          franchisee_name: row.franchisee_name,
          nengineer: row.nengineer ? String(row.nengineer) : '0',
          technician_name: row.technician_name || 'UNKNOWN',
          call_count: parseInt(row.call_count || '1'),
        });
      });

      const criteria = {
        state: state || 'All',
        city: city || 'All',
        branch: branch || 'All',
        franchisee: franchisee || 'All',
        technician: technician || 'All'
      };

      // 1. States (exclude state filter)
      const statesFiltered = filterCallsCSR(processedOptions, criteria, 'state');
      const stateCounts: Record<string, { vname: string; call_count: number }> = {};
      statesFiltered.forEach((c) => {
        if (!c.state || c.state === 'UNKNOWN') return;
        const sName = c.state;
        stateCounts[sName] = stateCounts[sName] || { vname: sName, call_count: 0 };
        stateCounts[sName].call_count += c.call_count;
      });
      responsePayload.statesList = Object.values(stateCounts).sort((a, b) => a.vname.localeCompare(b.vname));

      // 2. Cities (exclude city filter)
      const citiesFiltered = filterCallsCSR(processedOptions, criteria, 'city');
      const cityCounts: Record<string, { ncode: string; vname: string; nstate: string; call_count: number }> = {};
      citiesFiltered.forEach((c) => {
        if (!c.city || c.city === 'UNKNOWN') return;
        const cName = c.city;
        cityCounts[cName] = cityCounts[cName] || { ncode: cName, vname: cName, nstate: c.state || '', call_count: 0 };
        cityCounts[cName].call_count += c.call_count;
      });
      responsePayload.citiesList = Object.values(cityCounts).sort((a, b) => a.vname.localeCompare(b.vname));

      // 3. Branches (exclude branch filter)
      const branchesFiltered = filterCallsCSR(processedOptions, criteria, 'branch');
      const branchCounts: Record<string, { ncode: string; vcompanyname: string; call_count: number }> =
        {};
      branchesFiltered.forEach((c) => {
        const bCode = String(c.resolved_branch_code || c.nofficeid || '');
        if (!bCode || bCode === 'UNKNOWN') return;
        mergeBranchFilterListEntry(
          branchCounts,
          String(c.officename || c.office_name || bCode),
          bCode,
          c.call_count
        );
      });
      responsePayload.branchesList = Object.values(branchCounts).sort((a, b) => a.vcompanyname.localeCompare(b.vcompanyname));

      // 4. Franchisees (exclude franchisee filter)
      const franchiseesFiltered = filterCallsCSR(processedOptions, criteria, 'franchisee');
      const franchiseeCounts: Record<string, { ncode: string; vcompanyname: string; call_count: number }> = {};
      franchiseesFiltered.forEach((c) => {
        const fCode = c.franchisee_code;
        franchiseeCounts[fCode] = franchiseeCounts[fCode] || { ncode: fCode, vcompanyname: c.franchisee_name, call_count: 0 };
        franchiseeCounts[fCode].call_count += c.call_count;
      });
      responsePayload.franchiseesList = Object.values(franchiseeCounts).sort((a, b) => a.vcompanyname.localeCompare(b.vcompanyname));

      // 5. Technicians (exclude technician filter)
      const techniciansFiltered = filterCallsCSR(processedOptions, criteria, 'technician');
      const techCounts: Record<string, { ncode: string; vname: string; call_count: number }> = {};
      techniciansFiltered.forEach((c) => {
        if (!c.nengineer || c.nengineer === '0') return;
        const tCode = c.nengineer;
        techCounts[tCode] = techCounts[tCode] || { ncode: tCode, vname: c.technician_name, call_count: 0 };
        techCounts[tCode].call_count += c.call_count;
      });
      responsePayload.techniciansList = Object.values(techCounts).sort((a, b) => a.vname.localeCompare(b.vname));
      }
    }

    return NextResponse.json(responsePayload);

  } catch (error: unknown) {
    console.error('Report API Error:', error);
    return NextResponse.json({ error: toUserFacingError(error) }, { status: 500 });
  }
}
