/**
 * Reusable utility to export table data as a downloadable CSV file.
 * Guards against CSV formula injection: text cells starting with = + - @
 * are prefixed with an apostrophe (numeric values untouched).
 */
/** Plain decimal amounts (e.g. "-308.000", "+10") are data, not formulas. */
const PLAIN_NUMBER = /^[+-]?\d+([.,]\d+)?$/;

export function escapeCsvCell(cell: string | number): string {
  if (typeof cell === 'number') {
    return `"${String(cell)}"`;
  }
  const text = String(cell ?? '');
  const guarded = /^[=+\-@]/.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function exportToCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const csvContent = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map(row => row.map(escapeCsvCell).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
