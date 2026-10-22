import { ValidationError } from './validation.js';

/**
 * Normalizes a phone number to exactly 8 digits.
 * Accepts exactly 8 digits after stripping whitespace, "+216", and "00216".
 * Anything else throws a French 400 ValidationError.
 */
export function normalizePhone(rawPhone: unknown): string {
  if (typeof rawPhone !== 'string' && typeof rawPhone !== 'number') {
    throw new ValidationError('Le numéro de téléphone est obligatoire et doit comporter exactement 8 chiffres.');
  }

  let cleaned = String(rawPhone).replace(/\s+/g, '');

  if (cleaned.startsWith('+216')) {
    cleaned = cleaned.slice(4);
  } else if (cleaned.startsWith('00216')) {
    cleaned = cleaned.slice(5);
  }

  if (!/^\d{8}$/.test(cleaned)) {
    throw new ValidationError('Le numéro de téléphone doit comporter exactement 8 chiffres.');
  }

  return cleaned;
}
