import crypto from 'crypto';

/**
 * Generates a unique Code-128 compatible alphanumeric barcode string.
 * Standard format: SHSP-<random 8 digits> e.g. SHSP-48291042
 */
export function generateBarcode(prefix: string = 'SHSP'): string {
  const randomDigits = Math.floor(10000000 + Math.random() * 90000000).toString();
  return `${prefix}-${randomDigits}`;
}

/**
 * Validates whether a barcode string contains valid characters for Code-128.
 */
export function isValidBarcode(barcode: string): boolean {
  if (!barcode || typeof barcode !== 'string') return false;
  const trimmed = barcode.trim();
  // Code-128 supports standard printable ASCII characters (32-126)
  return /^[\x20-\x7E]{3,48}$/.test(trimmed);
}
