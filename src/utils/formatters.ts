/**
 * Formats a numeric currency value into Tunisian Dinar display (3 decimal places).
 * e.g. 12.5 -> "12.500 DT"
 */
export function formatMoney(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(Number(amount))) {
    return '0.000 DT';
  }
  return `${roundMoney(Number(amount)).toFixed(3)} DT`;
}

/**
 * Returns 3-decimal string representation without currency suffix.
 * e.g. 12.5 -> "12.500"
 */
export function formatMoneyRaw(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(Number(amount))) {
    return '0.000';
  }
  return roundMoney(Number(amount)).toFixed(3);
}

/**
 * Rounds to 3 decimal places to prevent floating point inaccuracies.
 */
export function roundMoney(amount: number): number {
  const val = Number(amount) || 0;
  return Math.round((val + Number.EPSILON) * 1000) / 1000;
}

/**
 * Formats an ISO or SQLite date string (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss) into readable local date.
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('fr-TN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  } catch {
    return dateStr;
  }
}

/**
 * Formats an ISO or SQLite date string into readable local date and time.
 */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('fr-TN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
}
