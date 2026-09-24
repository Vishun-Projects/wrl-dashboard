import * as XLSX from 'xlsx';

const IMPORT_TZ = 'Asia/Kolkata';

export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Exact "Pepsi" only → Pepsi-Bott. Leaves Pepsi-Bott and other Pepsi* values alone. */
export function remapCustomerSubgroup(raw: string): string {
  const t = raw.trim();
  return t.toLowerCase() === 'pepsi' ? 'Pepsi-Bott' : t;
}

/** Digit-only sold-to (SAP customer number) is not a name. */
export function cleanCustomerName(raw: string): string {
  const t = raw.trim();
  if (!t || /^\d+$/.test(t)) return '';
  return t;
}

export function parseDateVal(val: unknown): string | null {
  if (val == null || val === '') return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: IMPORT_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(val);
    const pick = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? '';
    const y = pick('year');
    const m = pick('month');
    const d = pick('day');
    return y && m && d ? `${y}-${m}-${d}` : null;
  }

  if (typeof val === 'number' && val > 30000 && val < 70000) {
    try {
      const formatted = XLSX.SSF.format('yyyy-mm-dd', val);
      return /^\d{4}-\d{2}-\d{2}$/.test(formatted) ? formatted : null;
    } catch {
      return null;
    }
  }

  const str = String(val).trim();
  if (str.length >= 10 && str[2] === '.' && str[5] === '.') {
    return `${str.slice(6, 10)}-${str.slice(3, 5)}-${str.slice(0, 2)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  const slashParts = str.split(/[\/\-]/).map((part) => part.trim());
  if (slashParts.length === 3 && slashParts.every(Boolean)) {
    const [a, b, c] = slashParts;
    let year = Number(c);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const first = Number(a);
    const second = Number(b);
    if (Number.isInteger(first) && Number.isInteger(second) && Number.isInteger(year) && year >= 1900 && year <= 2100) {
      const day = first > 12 ? first : second > 12 ? second : first;
      const month = first > 12 ? second : second > 12 ? first : second;
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
  }
  if (!Number.isNaN(Number(str)) && Number(str) > 30000 && Number(str) < 70000) {
    try {
      return XLSX.SSF.format('yyyy-mm-dd', Number(str));
    } catch {
      return null;
    }
  }
  return null;
}

/** Calendar months from start → end. Same day is 0. Missing dates is 0 (do not invent 12). */
export function calcMonths(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const [ys, ms, ds] = start.split('-').map(Number);
  const [ye, me, de] = end.split('-').map(Number);
  if (![ys, ms, ds, ye, me, de].every(Number.isFinite)) return 0;
  let months = (ye - ys) * 12 + (me - ms);
  if (de < ds) months -= 1;
  return months < 0 ? 0 : months;
}

export function warrantyDateRank(date: string | null): number {
  return date ? new Date(`${date}T00:00:00Z`).getTime() : Number.NEGATIVE_INFINITY;
}

export function mapSheetHeaders(rawKeys: string[]): Record<string, string> {
  const keyMap: Record<string, string> = {};
  for (const rawKey of rawKeys) {
    const norm = normalizeHeader(rawKey);
    if (norm.includes('serial') || norm === 'vserialno' || norm === 'serialno') {
      keyMap.serial = rawKey;
    } else if (norm.includes('billingdoc') || norm.includes('invoiceno') || norm === 'billdoc') {
      keyMap.billingDoc = rawKey;
    } else if (
      norm.includes('billingdate') ||
      norm.includes('billdate') ||
      norm.includes('invoicedate') ||
      norm.includes('invdate') ||
      norm.includes('billingdt') ||
      norm.includes('billdt') ||
      norm.includes('invoicedt') ||
      norm.includes('invdt') ||
      norm.includes('docdate') ||
      norm.includes('documentdate')
    ) {
      keyMap.billingDate = rawKey;
    } else if (norm === 'groupname' || norm === 'group' || norm === 'matlgroup') {
      keyMap.groupName = rawKey;
    } else if (norm.includes('materialgroup') || norm.includes('itemgroup') || norm === 'extmaterialgrp') {
      keyMap.materialGroup = rawKey;
    } else if (norm.includes('material') || norm.includes('fgmodel') || norm.includes('model') || norm.includes('productcode')) {
      keyMap.material = rawKey;
    } else if (norm.includes('productsubgroup') || (norm.includes('subgroup') && !norm.includes('customer'))) {
      keyMap.productSubgroup = rawKey;
    } else if (norm.includes('customersoldto') || norm.includes('soldto') || norm === 'customername' || norm === 'customer') {
      keyMap.customer = rawKey;
    } else if (norm.includes('customersubgroup') || norm.includes('custsubgrp') || norm.includes('cgrp1') || norm === 'subgroup') {
      keyMap.customerSubgroup = rawKey;
    } else if (norm.includes('customershipto') || norm.includes('shipto') || norm.includes('consignee')) {
      keyMap.shipTo = rawKey;
    } else if (norm.includes('state') || norm.includes('shiptostate')) {
      keyMap.state = rawKey;
    } else if (norm.includes('shiptocity') || (norm.includes('city') && !keyMap.city)) {
      keyMap.shipToCity = rawKey;
    } else if (norm === 'city') {
      keyMap.city = rawKey;
    } else if (norm.includes('inventory')) {
      keyMap.inventory = rawKey;
    } else if (norm.includes('warrda') || norm.includes('warrstart') || norm.includes('startdate')) {
      keyMap.warrStart = rawKey;
    } else if (norm.includes('wtyend') || norm.includes('warrend') || norm.includes('enddate')) {
      keyMap.warrEnd = rawKey;
    } else if (norm.includes('pincode') || norm.includes('pin') || norm.includes('zip')) {
      keyMap.pin = rawKey;
    }
  }
  return keyMap;
}
