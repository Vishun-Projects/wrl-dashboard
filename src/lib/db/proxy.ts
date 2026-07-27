import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

const DB_URL = 'https://westerncrm.com/wrl/OTHERS/DBQUERY.aspx';

const SESSION_CACHE_MS = Number(process.env.CRM_SESSION_CACHE_MS ?? 30_000) || 30_000;
const CRM_SESSION_GET_TIMEOUT_MS =
  Number(process.env.CRM_SESSION_GET_TIMEOUT_MS ?? 180_000) || 180_000;
const CRM_SESSION_GET_MAX_ATTEMPTS = 3;

let cachedState: {
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
} | null = null;
let lastFetch = 0;
let sessionInflight: Promise<{
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
}> | null = null;

type QueryParams = {
  top?: string;
  fields?: string;
  tableName?: string;
  condition?: string;
  orderBy?: string;
  rawSql?: string;
  timeoutMs?: number;
};

export type CrmQueryError = Error & { crmOutOfMemory?: boolean };

/** CRM DBQUERY.aspx serializes the full grid into ASP.NET viewstate — large results OOM the server. */
export function isCrmOutOfMemoryError(err: unknown): boolean {
  if (err && typeof err === 'object' && (err as CrmQueryError).crmOutOfMemory) return true;
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('OutOfMemoryException') || msg.includes('CRM viewstate OOM')) return true;
  if (msg.includes('Date range too large')) return true;
  if (axios.isAxiosError(err) && typeof err.response?.data === 'string') {
    return err.response.data.includes('OutOfMemoryException');
  }
  return false;
}

function crmOutOfMemoryFromBody(body: string | undefined): boolean {
  return !!body?.includes('OutOfMemoryException');
}

function crmSqlTimeoutMessage(body: string | undefined, message: string): boolean {
  const haystack = `${body ?? ''}\n${message}`.toLowerCase();
  return (
    haystack.includes('timeout expired') ||
    haystack.includes('timeout period elapsed') ||
    haystack.includes('etimedout')
  );
}

/** Axios client timeout or CRM SQL timeout text in the response body. */
export function isCrmSqlTimeoutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (crmSqlTimeoutMessage(undefined, message)) return true;
  if (message.includes('timeout of') && message.includes('exceeded')) return true;
  if (axios.isAxiosError(err)) {
    const body =
      typeof err.response?.data === 'string' ? err.response.data : undefined;
    return crmSqlTimeoutMessage(body, message);
  }
  return false;
}

function describeQuery(params: QueryParams): string {
  if (params.rawSql) {
    const sql = params.rawSql.replace(/\s+/g, ' ').trim();
    return `rawSql: ${sql.slice(0, 140)}${sql.length > 140 ? '…' : ''}`;
  }
  const table = params.tableName?.replace(/\s+/g, ' ').trim() ?? '';
  const condition = params.condition?.replace(/\s+/g, ' ').trim() ?? '';
  const orderBy = params.orderBy?.replace(/\s+/g, ' ').trim() ?? '';
  const parts = [
    table ? `table=${table.slice(0, 100)}${table.length > 100 ? '…' : ''}` : null,
    condition && condition !== '1=1'
      ? `where=${condition.slice(0, 80)}${condition.length > 80 ? '…' : ''}`
      : null,
    orderBy ? `order=${orderBy.slice(0, 60)}` : null,
  ].filter(Boolean);
  return parts.join(' | ') || 'empty query';
}

function logCrmTiming(
  event: string,
  elapsedMs: number,
  detail: Record<string, unknown>
): void {
  void event;
  void elapsedMs;
  void detail;
  /* no-op */
}

async function fetchAppStateOnce(): Promise<{
  viewState: string;
  viewStateGenerator: string;
  eventValidation: string;
}> {
  let attempts = 0;
  while (attempts < CRM_SESSION_GET_MAX_ATTEMPTS) {
    attempts++;
    const sessionStart = Date.now();
    try {
      const res = await axios.get(DB_URL, {
        timeout: CRM_SESSION_GET_TIMEOUT_MS,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const sessionMs = Date.now() - sessionStart;
      logCrmTiming('GET session (viewstate)', sessionMs, {
        status: res.status,
        cached: false,
        attempt: `${attempts}/${CRM_SESSION_GET_MAX_ATTEMPTS}`,
      });

      const $ = cheerio.load(res.data);
      return {
        viewState: ($('#__VIEWSTATE').val() as string) || '',
        viewStateGenerator: ($('#__VIEWSTATEGENERATOR').val() as string) || '',
        eventValidation: ($('#__EVENTVALIDATION').val() as string) || '',
      };
    } catch (err: unknown) {
      const sessionMs = Date.now() - sessionStart;
      const errMessage = err instanceof Error ? err.message : String(err);
      const errCode =
        (err as { code?: string })?.code ??
        (err as { cause?: { code?: string } })?.cause?.code;
      const isTimeout =
        errCode === 'ECONNABORTED' ||
        errCode === 'ETIMEDOUT' ||
        errMessage.includes('timeout of') ||
        errMessage.includes('ETIMEDOUT');

      if (attempts >= CRM_SESSION_GET_MAX_ATTEMPTS) {
        logCrmTiming('GET session failed (max retries)', sessionMs, {
          attempt: `${attempts}/${CRM_SESSION_GET_MAX_ATTEMPTS}`,
          error: errMessage.slice(0, 200),
        });
        throw err;
      }

      logCrmTiming('GET session failed (retrying)', sessionMs, {
        attempt: `${attempts}/${CRM_SESSION_GET_MAX_ATTEMPTS}`,
        error: errMessage.slice(0, 200),
        willRetry: true,
      });

      cachedState = null;
      lastFetch = 0;
      await new Promise((r) => setTimeout(r, isTimeout ? 5000 * attempts : 2000));
    }
  }

  throw new Error('CRM session fetch failed');
}

export async function getAppState() {
  const now = Date.now();
  if (cachedState && now - lastFetch < SESSION_CACHE_MS) {
    return cachedState;
  }

  if (!sessionInflight) {
    sessionInflight = fetchAppStateOnce()
      .then((state) => {
        cachedState = state;
        lastFetch = Date.now();
        return state;
      })
      .finally(() => {
        sessionInflight = null;
      });
  }

  return sessionInflight;
}

async function executePostWithRetry(params: QueryParams, signal?: AbortSignal) {
  const queryDesc = describeQuery(params);
  const { viewState, viewStateGenerator, eventValidation } = await getAppState();
  const requestTimeout = params.timeoutMs ?? 100000;

  const formData = new URLSearchParams();
  formData.append('__VIEWSTATE', viewState);
  formData.append('__VIEWSTATEGENERATOR', viewStateGenerator);
  if (eventValidation) formData.append('__EVENTVALIDATION', eventValidation);

  if (params.rawSql) {
    let sql = params.rawSql.trim();
    const sqlUpper = sql.toUpperCase();
    const hasOffsetFetch = sqlUpper.includes('OFFSET') || sqlUpper.includes('FETCH NEXT');
    if (
      sqlUpper.includes('ORDER BY') &&
      !/^\s*SELECT\s+(?:DISTINCT\s+)?TOP\b/i.test(sql) &&
      !hasOffsetFetch
    ) {
      // SQL Server: TOP must follow DISTINCT, not precede it (SELECT TOP … DISTINCT is invalid).
      if (/^\s*SELECT\s+DISTINCT\b/i.test(sql)) {
        sql = sql.replace(/^(\s*SELECT\s+DISTINCT)\b/i, '$1 TOP 100 PERCENT');
      } else {
        sql = sql.replace(/^(\s*SELECT)\b/i, '$1 TOP 100 PERCENT');
      }
    }
    formData.append('txt_Fields', '*');
    formData.append('txt_TableName', `(${sql}) as t`);
    formData.append('txt_Condition', '1=1');
    formData.append('txt_OrderBy', '');
  } else {
    formData.append('txt_Top', params.top || '');
    formData.append('txt_Fields', params.fields || '');
    formData.append('txt_TableName', params.tableName || '');
    formData.append('txt_Condition', params.condition || '1=1');
    formData.append('txt_OrderBy', params.orderBy || '');
  }
  formData.append('btn_View', 'Execute');

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;
    const postStart = Date.now();
    try {
      const res = await axios.post(DB_URL, formData, {
        timeout: requestTimeout,
        signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0',
        },
      });
      const postMs = Date.now() - postStart;

      const $ = cheerio.load(res.data);
      const error = $('#lbl_Error').text();
      if (error && error.trim()) {
        const errText = error.trim();
        if (errText.includes('No record found')) {
          logCrmTiming('POST round-trip (no records)', postMs, {
            attempt: `${attempts}/${maxAttempts}`,
            status: res.status,
            query: queryDesc,
          });
          return { $, data: [], columns: [], message: 'No record found' };
        }

        if (errText.includes('deadlocked') || errText.includes('chosen as the deadlock victim')) {
          logCrmTiming('POST round-trip (deadlock, retrying)', postMs, {
            attempt: `${attempts}/${maxAttempts}`,
            query: queryDesc,
            error: errText.slice(0, 200),
          });
          await new Promise((r) => setTimeout(r, attempts * 5000));
          continue;
        }

        if (crmSqlTimeoutMessage(errText, errText)) {
          logCrmTiming('POST failed (SQL timeout — no retry)', postMs, {
            attempt: `${attempts}/${maxAttempts}`,
            query: queryDesc,
            error: errText.slice(0, 200),
          });
          throw new Error(errText);
        }

        logCrmTiming('POST round-trip (CRM error)', postMs, {
          attempt: `${attempts}/${maxAttempts}`,
          query: queryDesc,
          error: errText.slice(0, 200),
        });
        throw new Error(errText);
      }

      logCrmTiming('POST round-trip', postMs, {
        attempt: `${attempts}/${maxAttempts}`,
        status: res.status,
        responseBytes: typeof res.data === 'string' ? res.data.length : null,
        query: queryDesc,
      });

      return { $ };
    } catch (err: unknown) {
      const postMs = Date.now() - postStart;
      if (axios.isCancel(err)) throw err;

      const axiosErr = axios.isAxiosError(err) ? err : null;
      const httpStatus = axiosErr?.response?.status;
      const httpBody =
        axiosErr?.response?.data != null
          ? typeof axiosErr.response.data === 'string'
            ? axiosErr.response.data.slice(0, 400)
            : JSON.stringify(axiosErr.response.data).slice(0, 400)
          : undefined;

      const errMessage = err instanceof Error ? err.message : String(err);
      if (crmSqlTimeoutMessage(httpBody, errMessage)) {
        logCrmTiming('POST failed (SQL timeout — no retry)', postMs, {
          attempt: `${attempts}/${maxAttempts}`,
          query: queryDesc,
          error: errMessage.slice(0, 200),
        });
        throw err;
      }

      if (crmOutOfMemoryFromBody(httpBody)) {
        logCrmTiming('POST failed (CRM viewstate OOM — no retry)', postMs, {
          attempt: `${attempts}/${maxAttempts}`,
          query: queryDesc,
          httpStatus,
        });
        const oomErr = new Error(
          'Date range too large — use a smaller date range'
        ) as CrmQueryError;
        oomErr.crmOutOfMemory = true;
        throw oomErr;
      }

      if (attempts === maxAttempts) {
        logCrmTiming('POST failed (max retries)', postMs, {
          attempt: `${attempts}/${maxAttempts}`,
          query: queryDesc,
          error: err instanceof Error ? err.message : String(err),
          ...(httpStatus != null ? { httpStatus } : {}),
          ...(httpBody ? { httpBodySnippet: httpBody } : {}),
        });
        throw err;
      }

      const errCode =
        (err as { code?: string })?.code ??
        (err as { cause?: { code?: string } })?.cause?.code;
      const isReset =
        errCode === 'ECONNRESET' ||
        errCode === 'ETIMEDOUT' ||
        errMessage.includes('ECONNRESET') ||
        errMessage.includes('ETIMEDOUT');
      const isOverloaded = errMessage.includes('503') || isReset;

      logCrmTiming('POST failed (retrying)', postMs, {
        attempt: `${attempts}/${maxAttempts}`,
        query: queryDesc,
        error: errMessage.slice(0, 200),
        willRetry: true,
        ...(httpStatus != null ? { httpStatus } : {}),
        ...(httpBody ? { httpBodySnippet: httpBody } : {}),
      });

      if (isReset) {
        cachedState = null;
        lastFetch = 0;
      }

      await new Promise((r) => setTimeout(r, isOverloaded ? 10000 * attempts : 3000));
    }
  }
  throw new Error('Maximum retry attempts reached');
}

export async function postQuery(
  params: QueryParams,
  signal?: AbortSignal
) {
  const queryDesc = describeQuery(params);
  const totalStart = Date.now();
  const result = await executePostWithRetry(params, signal);
  if ('data' in result) {
    const totalMs = Date.now() - totalStart;
    logCrmTiming('postQuery complete', totalMs, {
      rows: Array.isArray(result.data) ? result.data.length : 0,
      query: queryDesc,
    });
    return result;
  }

  const parseStart = Date.now();
  const { $ } = result as { $: ReturnType<typeof cheerio.load> };
  let resultTable = $('#ResultGrid');
  if (!resultTable.length) {
    resultTable = $('fieldset legend:contains("Result")').parent().find('table');
  }

  if (!resultTable.length) {
    const totalMs = Date.now() - totalStart;
    logCrmTiming('postQuery complete (empty grid)', totalMs, {
      rows: 0,
      parseMs: Date.now() - parseStart,
      query: queryDesc,
    });
    return { data: [], columns: [], message: 'No data returned' };
  }

  const data: Record<string, string>[] = [];
  const columns: string[] = [];
  const rows = resultTable
    .find('tr')
    .filter((i: number, el: Element) => $(el).closest('table').is(resultTable));

  rows.each((i: number, row: Element) => {
    if (i === 0) {
      $(row).find('td, th').each((j: number, cell: Element) => {
        const colName = $(cell).text().trim();
        if (colName) columns.push(colName);
      });
    } else {
      const rowData: Record<string, string> = {};
      $(row).find('td').each((j: number, cell: Element) => {
        const colName = columns[j] || `Col${j}`;
        rowData[colName] = $(cell).text().trim();
      });
      if (Object.keys(rowData).length > 0) data.push(rowData);
    }
  });

  const parseMs = Date.now() - parseStart;
  const totalMs = Date.now() - totalStart;
  logCrmTiming('postQuery complete', totalMs, {
    rows: data.length,
    columns: columns.length,
    parseMs,
    query: queryDesc,
  });

  return { data, columns };
}
