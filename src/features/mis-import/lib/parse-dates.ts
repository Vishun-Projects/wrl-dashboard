const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** Parse client date strings (Coke VDate, Cadbury Call Log Date, Excel serial, etc.). */
export function parseClientDate(raw: string | number | null | undefined): Date | null {
  if (raw == null) return null;

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return excelSerialToDate(raw);
  }

  const value = String(raw).trim();
  if (!value) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(value)) {
    if (numeric > 10000 && numeric < 100000) {
      const fromSerial = excelSerialToDate(numeric);
      if (fromSerial) return fromSerial;
    }
  }

  // Coke CDMS / India exports use DD/MM/YYYY — parse before `new Date()` (US MM/DD).
  const dmyDash = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmyDash) {
    const [, d, m, y] = dmyDash;
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const dmySlash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmySlash) {
    const [, d, m, y] = dmySlash;
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const cokeStyle = value.match(
    /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})(AM|PM)$/i
  );
  if (cokeStyle) {
    const [, mon, day, year, hour, minute, ampm] = cokeStyle;
    const month = MONTHS[mon.toLowerCase().slice(0, 3)];
    if (month == null) return null;
    let h = Number(hour);
    if (ampm.toUpperCase() === 'PM' && h < 12) h += 12;
    if (ampm.toUpperCase() === 'AM' && h === 12) h = 0;
    const dt = new Date(Number(year), month, Number(day), h, Number(minute));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;

  return null;
}

/** Excel day serial (1900 date system) → local Date at midnight. */
function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const utcMs = Math.round((serial - 25569) * 86400 * 1000);
  const dt = new Date(utcMs);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
