export class ValidationError extends Error {
  public status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validates that value is a finite number strictly greater than 0.
 * Rejects NaN, Infinity, strings like "abc", negative numbers, 0, null, undefined.
 */
export function requireFinitePositive(value: unknown, fieldName: string): number {
  if (value === null || value === undefined || value === '') {
    throw new ValidationError(`Le champ ${fieldName} est obligatoire et doit être supérieur à zéro.`);
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError(`Le champ ${fieldName} doit être un nombre strictement positif (> 0).`);
  }
  return n;
}

/**
 * Validates that value is a finite number greater than or equal to 0.
 * Rejects NaN, Infinity, non-numeric strings, negative numbers.
 */
export function requireFiniteNonNegative(
  value: unknown,
  fieldName: string,
  defaultValue?: number
): number {
  if (value === null || value === undefined || value === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new ValidationError(`Le champ ${fieldName} est obligatoire et doit être positif ou nul.`);
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError(`Le champ ${fieldName} doit être un nombre positif ou nul (>= 0).`);
  }
  return n;
}

/**
 * Validates that an optional value, if provided, is finite and > 0.
 * If undefined, null or empty string, returns undefined.
 */
export function requireOptionalFinitePositive(
  value: unknown,
  fieldName: string
): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError(`Le champ ${fieldName} doit être un nombre strictement positif (> 0).`);
  }
  return n;
}

/**
 * Validates that an optional value, if provided, is finite and >= 0.
 * If undefined, null or empty string, returns undefined.
 */
export function requireOptionalFiniteNonNegative(
  value: unknown,
  fieldName: string
): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError(`Le champ ${fieldName} doit être un nombre positif ou nul (>= 0).`);
  }
  return n;
}

/**
 * Cleans an error message so raw SQL text and constraint messages are never exposed.
 */
export function sanitizeErrorMessage(err: any, fallbackMessage: string = 'Une erreur est survenue'): string {
  const msg = String(err?.message || '');
  if (/SQLITE|constraint failed|syntax error|no such table/i.test(msg)) {
    return fallbackMessage;
  }
  return msg || fallbackMessage;
}
