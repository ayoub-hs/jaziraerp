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
