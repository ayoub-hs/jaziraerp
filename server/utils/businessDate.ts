/**
 * Business-date helpers. Number prefixes (receipts, tickets, batches) and
 * calendar-day defaults use the shop timezone Africa/Tunis, not UTC.
 */
const tunisDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Tunis',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** Calendar day in Tunis as YYYY-MM-DD (en-CA formats exactly so). */
export function businessDateISO(date: Date = new Date()): string {
  return tunisDay.format(date);
}

/** Compact key for number prefixes: YYYYMMDD in Tunis. */
export function businessDateKey(date: Date = new Date()): string {
  return businessDateISO(date).replace(/-/g, '');
}

const tunisWallClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Tunis',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

/** Tunis UTC offset in ms at a given UTC instant (robust even if DST ever returns). */
function tunisOffsetMs(utcMs: number): number {
  const parts: Record<string, string> = {};
  for (const p of tunisWallClock.formatToParts(new Date(utcMs))) {
    parts[p.type] = p.value;
  }
  const wallAsUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return wallAsUTC - utcMs;
}

/** UTC instant of Tunis midnight starting calendar day (y, mo, d). */
function tunisMidnightUTC(y: number, mo: number, d: number): number {
  const base = Date.UTC(y, mo - 1, d, 0, 0, 0);
  let ms = base;
  for (let i = 0; i < 3; i++) {
    ms = base - tunisOffsetMs(ms);
  }
  return ms;
}

/**
 * Converts a Tunis calendar day (YYYY-MM-DD) to the UTC [start, end) range
 * covering it. Use for day filters: `date >= start AND date < end`.
 * Throws on invalid day format.
 */
export function tunisDayRangeUTC(day: string): { start: string; end: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) throw new Error(`Invalid day "${day}", expected YYYY-MM-DD`);
  const startMs = tunisMidnightUTC(Number(m[1]), Number(m[2]), Number(m[3]));
  const next = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  const endMs = tunisMidnightUTC(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
}

/** True for YYYY-MM-DD filter days the range helper accepts. */
export function isFilterDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}
