import 'server-only';

import {
  extractPincodeFromAddress,
  geocodeAddressFromIndiaPost,
  gpsProximityToInstallAreaKm,
  lookupPincodeAtCoords,
  normalizePincodeForCompare,
  PINCODE_FRAUD_MAX_PROXIMITY_KM,
} from '@/lib/geo/india-post';
import { distanceMeters, MISMATCH_RADIUS_M } from '@/lib/geo/haversine';
import {
  formatGpsSourceForDisplay,
  parseCrmGpsFromPartyFields,
  parseVisitGpsFromFields,
  type CrmGpsSource,
} from '@/lib/geo/parse-latlong';
import { resolveInstallAddressCoords } from '@/lib/report-geo';

import type {
  LocationAuditByBranch,
  LocationAuditDetailRow,
  LocationAuditFraudSignal,
  LocationAuditListRow,
  LocationAuditSeverity,
  LocationAuditSignalResult,
  LocationAuditSignals,
  LocationAuditStatus,
  LocationAuditSummary,
} from '@/lib/location-audit/types';

const VISIT_STORED_MAX_M = 500;
const VISIT_INSTALL_MAX_M = 1000;

function storedGpsRawValue(raw: Record<string, unknown>, source: CrmGpsSource): string {
  const vlat = String(raw.vlatlong ?? '').trim();
  const mlat = String(raw.mlatlong ?? '').trim();
  if (source === 'vlatlong') return vlat;
  if (source === 'mlatlong') return mlat;
  return vlat || mlat;
}

function buildPincodeCheck(opts: {
  installPincode: string;
  installState: string;
  installCity: string;
  address: string;
  stored: { lat: number; lng: number };
}): Pick<
  LocationAuditListRow,
  | 'pincodeInAddress'
  | 'storedGpsPincode'
  | 'storedGpsPincodeArea'
  | 'pincodeMatchStatus'
  | 'pincodeCheckNote'
  | 'fraudSignal'
  | 'gpsToInstallAreaKm'
> {
  const install = normalizePincodeForCompare(opts.installPincode);
  const inAddress = extractPincodeFromAddress(opts.address);
  const areaOpts = {
    installPincode: opts.installPincode,
    installState: opts.installState,
    installCity: opts.installCity,
    address: opts.address,
  };
  const proximityKm = gpsProximityToInstallAreaKm(
    opts.stored.lat,
    opts.stored.lng,
    areaOpts
  );
  const atGps = lookupPincodeAtCoords(opts.stored.lat, opts.stored.lng, areaOpts);
  const storedPin = atGps ? normalizePincodeForCompare(atGps.pincode) : '';

  let pincodeMatchStatus: 'same' | 'different' | 'unknown' = 'unknown';
  if (install && storedPin) {
    if (install === storedPin) {
      pincodeMatchStatus = 'same';
    } else if (
      proximityKm != null &&
      proximityKm <= PINCODE_FRAUD_MAX_PROXIMITY_KM
    ) {
      pincodeMatchStatus = 'same';
    } else {
      pincodeMatchStatus = 'different';
    }
  }

  const parts: string[] = [];
  if (install && inAddress && install !== inAddress) {
    parts.push(`Address text has pincode ${inAddress}, install record has ${install}.`);
  }
  if (install && storedPin && install !== storedPin && pincodeMatchStatus === 'same') {
    parts.push(
      `India Post nearest area pincode is ${storedPin} (${atGps?.district ?? 'area'}) but GPS is ~${proximityKm} km from install area` +
        (opts.installCity ? ` (${opts.installCity})` : ` (pincode ${install})`) +
        ` — within ${PINCODE_FRAUD_MAX_PROXIMITY_KM} km, treated as same locality.`
    );
  } else if (pincodeMatchStatus === 'different') {
    parts.push(
      `Install pincode ${install || '(empty)'} but stored GPS maps to pincode ${storedPin}` +
        (atGps ? ` (${atGps.area}, ${atGps.district})` : '') +
        (proximityKm != null
          ? ` (~${proximityKm} km from install area, over ${PINCODE_FRAUD_MAX_PROXIMITY_KM} km threshold).`
          : '.') +
        ' GPS was likely captured in a different city/area than the install address.'
    );
  } else if (pincodeMatchStatus === 'same' && install === storedPin) {
    parts.push(`Pincode ${install} matches at both install and stored GPS.`);
  } else if (!install) {
    parts.push('Install pincode missing on call — cannot compare to GPS area.');
  } else if (!storedPin) {
    parts.push('Could not resolve a pincode near stored GPS coordinates.');
  }

  const storedGpsPincodeArea = atGps
    ? `${atGps.area}, ${atGps.district} (${atGps.distanceKm.toFixed(1)} km from post office)`
    : '';

  const fraudSignal: LocationAuditFraudSignal =
    pincodeMatchStatus === 'different' ? 'pincode_mismatch' : 'none';

  return {
    pincodeInAddress: inAddress,
    storedGpsPincode: storedPin,
    storedGpsPincodeArea,
    pincodeMatchStatus,
    pincodeCheckNote: parts.join(' '),
    fraudSignal,
    gpsToInstallAreaKm: proximityKm,
  };
}

function computeListSeverity(row: {
  status: LocationAuditStatus;
  fraudSignal: LocationAuditFraudSignal;
  pincodeInAddress: string;
  pincode: string;
  gpsToInstallAreaKm: number | null;
}): LocationAuditSeverity {
  if (row.status === 'no_address' || row.status === 'no_gps') return 'incomplete';
  const install = normalizePincodeForCompare(row.pincode);
  const inAddress = row.pincodeInAddress;
  if (install && inAddress && install !== inAddress) return 'review';
  if (row.status === 'mismatch' || row.fraudSignal === 'pincode_mismatch') return 'flag';
  if (row.gpsToInstallAreaKm != null && row.gpsToInstallAreaKm > PINCODE_FRAUD_MAX_PROXIMITY_KM) {
    return 'review';
  }
  return 'ok';
}

function computeDetailSeverity(
  list: LocationAuditListRow,
  detail: {
    distanceToInstallM: number | null;
    distanceVisitToInstallM: number | null;
    distanceVisitToStoredM: number | null;
    visitLat: number | null;
    visitLng: number | null;
    remoteSupport?: boolean;
  }
): LocationAuditSeverity {
  if (list.status === 'no_address' || list.status === 'no_gps') return 'incomplete';

  const pincodeFail =
    list.fraudSignal === 'pincode_mismatch' || list.pincodeMatchStatus === 'different';

  if (pincodeFail) return 'flag';
  if (detail.distanceToInstallM != null && detail.distanceToInstallM > MISMATCH_RADIUS_M) {
    return 'flag';
  }
  if (
    !detail.remoteSupport &&
    detail.visitLat != null &&
    detail.distanceVisitToInstallM != null &&
    detail.distanceVisitToInstallM > VISIT_INSTALL_MAX_M
  ) {
    return 'flag';
  }
  if (
    !detail.remoteSupport &&
    detail.visitLat != null &&
    detail.distanceVisitToStoredM != null &&
    detail.distanceVisitToStoredM > VISIT_STORED_MAX_M
  ) {
    return 'flag';
  }

  const install = normalizePincodeForCompare(list.pincode);
  if (install && list.pincodeInAddress && install !== list.pincodeInAddress) return 'review';

  if (detail.distanceToInstallM != null && detail.distanceToInstallM > MISMATCH_RADIUS_M / 2) {
    return 'review';
  }
  if (list.gpsToInstallAreaKm != null && list.gpsToInstallAreaKm > PINCODE_FRAUD_MAX_PROXIMITY_KM) {
    return 'review';
  }
  if (detail.visitLat == null && list.status === 'ok') return 'review';

  return 'ok';
}

function buildSignals(
  list: LocationAuditListRow,
  detail: {
    distanceToInstallM: number | null;
    distanceVisitToInstallM: number | null;
    distanceVisitToStoredM: number | null;
    visitLat: number | null;
    visitLng: number | null;
    remoteSupport?: boolean;
  }
): LocationAuditSignals {
  const pincodeFail =
    list.fraudSignal === 'pincode_mismatch' || list.pincodeMatchStatus === 'different';
  const pincode: LocationAuditSignalResult = {
    pass: !pincodeFail,
    reason: pincodeFail
      ? `Install pincode ${list.pincode || '—'} ≠ pincode at GPS ${list.storedGpsPincode || '—'}`
      : 'Install and GPS area pincodes align',
  };

  const distM = detail.distanceToInstallM;
  const distance: LocationAuditSignalResult = {
    pass: distM == null || distM <= MISMATCH_RADIUS_M,
    reason:
      distM == null
        ? 'Could not resolve expected install coordinates'
        : distM <= MISMATCH_RADIUS_M
          ? `Stored GPS is ${(distM / 1000).toFixed(1)} km from expected install`
          : `Stored GPS is ${(distM / 1000).toFixed(1)} km from expected install (over 1 km)`,
  };

  const install = normalizePincodeForCompare(list.pincode);
  const inAddr = list.pincodeInAddress;
  const addressPin: LocationAuditSignalResult = {
    pass: !install || !inAddr || install === inAddr,
    reason:
      install && inAddr && install !== inAddr
        ? `Address text pincode ${inAddr} ≠ install field ${install}`
        : 'Address and install pincodes match',
  };

  let visit: LocationAuditSignalResult;
  if (detail.remoteSupport) {
    visit = { pass: true, reason: 'Remote support visit — GPS check skipped' };
  } else if (detail.visitLat == null) {
    visit = { pass: false, reason: 'No visit GPS on latest visit record' };
  } else if (
    detail.distanceVisitToInstallM != null &&
    detail.distanceVisitToInstallM > VISIT_INSTALL_MAX_M
  ) {
    visit = {
      pass: false,
      reason: `Visit GPS is ${(detail.distanceVisitToInstallM / 1000).toFixed(1)} km from install`,
    };
  } else if (
    detail.distanceVisitToStoredM != null &&
    detail.distanceVisitToStoredM > VISIT_STORED_MAX_M
  ) {
    visit = {
      pass: false,
      reason: `Visit GPS differs from stored GPS by ${Math.round(detail.distanceVisitToStoredM)} m`,
    };
  } else {
    visit = { pass: true, reason: 'Visit GPS aligns with install and stored capture' };
  }

  return { pincode, distance, addressPin, visit };
}

export function buildMismatchExplanation(row: {
  status: LocationAuditStatus;
  fraudSignal: LocationAuditFraudSignal;
  vtrnno: string;
  address: string;
  pincode: string;
  gpsSource: CrmGpsSource;
  storedGpsRaw: string;
  crmLat: number | null;
  crmLng: number | null;
  pincodeCheckNote?: string;
  storedGpsPincode?: string;
  pincodeMatchStatus?: string;
  severity?: LocationAuditSeverity;
  distanceToInstallM?: number | null;
}): string {
  const stored =
    row.crmLat != null && row.crmLng != null
      ? `${row.crmLat}, ${row.crmLng}`
      : row.storedGpsRaw || 'not set';

  const distNote =
    row.distanceToInstallM != null
      ? ` Distance to expected install: ${(row.distanceToInstallM / 1000).toFixed(1)} km.`
      : '';

  switch (row.status) {
    case 'mismatch':
      return (
        `Call ${row.vtrnno}: pincode mismatch — install pincode ${row.pincode || '(empty)'} ` +
        `does not match pincode at stored GPS (${row.storedGpsPincode || 'unknown'}). ` +
        `Stored GPS (${formatGpsSourceForDisplay(row.gpsSource)}: ${stored}).` +
        distNote +
        ` ${row.pincodeCheckNote || ''} Address: ${row.address}`
      ).trim();
    case 'ok':
      if (row.pincodeMatchStatus === 'same') {
        return (
          `Call ${row.vtrnno}: install pincode ${row.pincode} matches pincode at stored GPS.` +
          distNote +
          ` Stored GPS: ${stored}. Address: ${row.address}`
        );
      }
      return (
        `Call ${row.vtrnno}: no pincode mismatch detected.` +
        distNote +
        ` Stored GPS: ${stored}. ${row.pincodeCheckNote || ''} Address: ${row.address}`
      ).trim();
    case 'no_gps':
      return `Call ${row.vtrnno}: no valid stored GPS on the call record. Address on call: ${row.address}`;
    case 'no_address':
      return `Call ${row.vtrnno}: install address missing or too short on call record.`;
    default:
      return '';
  }
}

export function analyzeListTierFromRaw(raw: Record<string, unknown>): LocationAuditListRow {
  const vtrnno = String(raw.vtrnno ?? '').trim();
  const address = String(raw.vinstaddress ?? '').trim();
  const pincode = String(raw.Pincode ?? '').trim();
  const city = String(raw.dbCity ?? '').trim();
  const state = String(raw.dbState ?? '').trim();
  const { coords: stored, source } = parseCrmGpsFromPartyFields(raw);
  const storedRaw = storedGpsRawValue(raw, source);

  const base: LocationAuditListRow = {
    vtrnno,
    ncode: String(raw.ncode ?? ''),
    officeId: String(raw.nofficeid ?? raw.office_id ?? '').trim(),
    vcclid: String(raw.vcclid ?? '').trim(),
    callDate: String(raw.callsdtrndate ?? '').trim(),
    callType: String(raw.calltype ?? '').trim(),
    repairPriority: 'Major',
    callStatus: 'Tech. Solve Call',
    partyName: String(raw.PartyName ?? '').trim(),
    address,
    pincode,
    city,
    state,
    branchName: String(raw.branch_office_name ?? '').trim(),
    officeName: String(raw.office_name ?? '').trim(),
    franchiseeName: String(raw.franchisee_name ?? '').trim(),
    franchiseeCode: String(raw.franchisee_code ?? '').trim(),
    technicianName: String(raw.serviceman ?? '').trim(),
    crmLat: stored?.lat ?? null,
    crmLng: stored?.lng ?? null,
    gpsSource: source,
    storedGpsRaw: storedRaw,
    status: 'no_gps',
    fraudSignal: 'none',
    pincodeInAddress: '',
    storedGpsPincode: '',
    storedGpsPincodeArea: '',
    pincodeMatchStatus: 'unknown',
    pincodeCheckNote: '',
    gpsToInstallAreaKm: null,
    severity: 'incomplete',
    mismatchExplanation: '',
  };

  if (!address || address.length < 5) {
    base.status = 'no_address';
    base.severity = 'incomplete';
    base.mismatchExplanation = buildMismatchExplanation(base);
    return base;
  }

  if (!stored) {
    base.status = 'no_gps';
    base.severity = 'incomplete';
    base.mismatchExplanation = buildMismatchExplanation(base);
    return base;
  }

  Object.assign(
    base,
    buildPincodeCheck({
      installPincode: pincode,
      installState: state,
      installCity: city,
      address,
      stored,
    })
  );
  base.status = base.fraudSignal === 'pincode_mismatch' ? 'mismatch' : 'ok';
  base.severity = computeListSeverity(base);
  base.mismatchExplanation = buildMismatchExplanation(base);
  return base;
}

export function enrichDetailTier(
  list: LocationAuditListRow,
  visitRaw: Record<string, unknown> | null
): LocationAuditDetailRow {
  let expectedInstallLat: number | null = null;
  let expectedInstallLng: number | null = null;
  let installGeocodeMethod = '';
  let installGeocodeArea = '';

  const geo = geocodeAddressFromIndiaPost({
    address: list.address,
    pincode: list.pincode,
    city: list.city,
    state: list.state,
  });
  if (geo.ok) {
    expectedInstallLat = geo.lat;
    expectedInstallLng = geo.lng;
    installGeocodeMethod = geo.source;
    installGeocodeArea = geo.matchedArea;
  } else {
    const fallback = resolveInstallAddressCoords({
      pincode: list.pincode,
      city: list.city,
      state: list.state,
    });
    if (fallback) {
      expectedInstallLat = fallback.lat;
      expectedInstallLng = fallback.lng;
      installGeocodeMethod = 'Pincode area centroid (approximate)';
      installGeocodeArea = list.pincode;
    } else {
      installGeocodeMethod = geo.reason;
    }
  }

  let distanceToInstallM: number | null = null;
  if (
    list.crmLat != null &&
    list.crmLng != null &&
    expectedInstallLat != null &&
    expectedInstallLng != null
  ) {
    distanceToInstallM = Math.round(
      distanceMeters(list.crmLat, list.crmLng, expectedInstallLat, expectedInstallLng)
    );
  }

  const visitParsed = visitRaw ? parseVisitGpsFromFields(visitRaw) : { coords: null, source: null };
  const visitLat = visitParsed.coords?.lat ?? null;
  const visitLng = visitParsed.coords?.lng ?? null;
  const visitGpsSource = visitParsed.source
    ? formatGpsSourceForDisplay(visitParsed.source as CrmGpsSource)
    : null;
  const visitDatetime = String(visitRaw?.dvisitdatetime ?? '').trim();
  const remoteSupport =
    String(visitRaw?.bremotesupport ?? '') === '1' || visitRaw?.bremotesupport === 1;

  let distanceVisitToInstallM: number | null = null;
  let distanceVisitToStoredM: number | null = null;
  if (visitLat != null && visitLng != null) {
    if (expectedInstallLat != null && expectedInstallLng != null) {
      distanceVisitToInstallM = Math.round(
        distanceMeters(visitLat, visitLng, expectedInstallLat, expectedInstallLng)
      );
    }
    if (list.crmLat != null && list.crmLng != null) {
      distanceVisitToStoredM = Math.round(
        distanceMeters(visitLat, visitLng, list.crmLat, list.crmLng)
      );
    }
  }

  const detailBase = {
    distanceToInstallM,
    distanceVisitToInstallM,
    distanceVisitToStoredM,
    visitLat,
    visitLng,
    remoteSupport,
  };

  const severity = computeDetailSeverity(list, detailBase);
  const signals = buildSignals(list, detailBase);

  const row: LocationAuditDetailRow = {
    ...list,
    expectedInstallLat,
    expectedInstallLng,
    installGeocodeMethod,
    installGeocodeArea,
    distanceToInstallM,
    visitLat,
    visitLng,
    visitGpsSource,
    visitDatetime,
    distanceVisitToInstallM,
    distanceVisitToStoredM,
    signals,
    severity,
    mismatchExplanation: buildMismatchExplanation({
      ...list,
      distanceToInstallM,
      severity,
    }),
  };

  if (severity === 'flag' && row.status === 'ok') {
    row.status = 'mismatch';
  }

  return row;
}

export function analyzeListTierRows(
  rawRows: Record<string, unknown>[]
): LocationAuditListRow[] {
  const rows = rawRows.map(analyzeListTierFromRaw);
  rows.sort((a, b) => {
    const rank = (s: LocationAuditSeverity) =>
      s === 'flag' ? 0 : s === 'review' ? 1 : s === 'incomplete' ? 2 : 3;
    const d = rank(a.severity) - rank(b.severity);
    if (d !== 0) return d;
    if (a.status === 'mismatch' && b.status !== 'mismatch') return -1;
    if (b.status === 'mismatch' && a.status !== 'mismatch') return 1;
    return a.vtrnno.localeCompare(b.vtrnno);
  });
  return rows;
}

function emptySummary(): LocationAuditSummary {
  return {
    totalCalls: 0,
    analyzedCap: 0,
    withCrmGps: 0,
    pincodeMismatch: 0,
    farFromInstall: 0,
    pincodeMatch: 0,
    missingAddress: 0,
    missingCrmGps: 0,
    pincodeUnknown: 0,
    missingInstallPincode: 0,
    addressPincodeConflict: 0,
    flagged: 0,
    review: 0,
  };
}

export function summarizeLocationAuditListRows(
  rows: LocationAuditListRow[],
  analyzedCap: number
): LocationAuditSummary {
  const summary = emptySummary();
  summary.totalCalls = rows.length;
  summary.analyzedCap = analyzedCap;

  for (const row of rows) {
    if (row.severity === 'flag') summary.flagged++;
    else if (row.severity === 'review') summary.review++;

    const install = normalizePincodeForCompare(row.pincode);
    const inAddr = row.pincodeInAddress;
    if (install && inAddr && install !== inAddr) summary.addressPincodeConflict++;

    switch (row.status) {
      case 'no_address':
        summary.missingAddress++;
        break;
      case 'no_gps':
        summary.missingCrmGps++;
        break;
      case 'mismatch':
        summary.withCrmGps++;
        summary.pincodeMismatch++;
        summary.mismatchOver1km = summary.pincodeMismatch;
        break;
      case 'ok':
        summary.withCrmGps++;
        if (row.pincodeMatchStatus === 'same') {
          summary.pincodeMatch++;
          summary.within1km = summary.pincodeMatch;
        } else if (row.pincodeMatchStatus === 'unknown') {
          if (!install) summary.missingInstallPincode++;
          else summary.pincodeUnknown++;
        } else {
          summary.pincodeMatch++;
        }
        break;
      default:
        break;
    }
  }
  return summary;
}

export function aggregateByBranch(rows: LocationAuditListRow[]): LocationAuditByBranch[] {
  const map = new Map<string, { pincodeMismatch: number; total: number }>();
  for (const row of rows) {
    const branch = row.branchName || 'Unknown';
    const entry = map.get(branch) ?? { pincodeMismatch: 0, total: 0 };
    entry.total++;
    if (row.status === 'mismatch' || row.severity === 'flag') entry.pincodeMismatch++;
    map.set(branch, entry);
  }
  return Array.from(map.entries())
    .map(([branch, v]) => ({
      branch,
      pincodeMismatch: v.pincodeMismatch,
      mismatchOver1km: v.pincodeMismatch,
      total: v.total,
    }))
    .sort((a, b) => b.pincodeMismatch - a.pincodeMismatch || b.total - a.total);
}

/** Full export: list tier + detail tier per row. */
export function analyzeFullExportRows(
  rawRows: Record<string, unknown>[],
  visitByNcode: Map<string, Record<string, unknown>>
): LocationAuditDetailRow[] {
  return analyzeListTierRows(rawRows).map((list) => {
    const visit = visitByNcode.get(`${list.ncode}:${list.officeId}`) ?? null;
    return enrichDetailTier(list, visit);
  });
}
