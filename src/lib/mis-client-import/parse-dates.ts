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

/** Parse client date strings (Coke VDate, Cadbury Call Log Date, etc.). */
export function parseClientDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;

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

  return null;
}
