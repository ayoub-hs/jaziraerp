export class ValidationError extends Error {
  public status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const PLAIN_DECIMAL_REGEX = /^\s*[+-]?\d+(?:\.\d+)?\s*$/;

/**
 * Validates that a value is strictly a real number or a string matching a plain decimal
 * (optional sign, digits, optional dot digits, surrounding spaces allowed).
 * Rejects booleans, arrays, hex, exponent forms, whitespace-only, etc.
 */
export function parsePlainDecimal(value: unknown, fieldName: string): number {
  if (typeof value === 'boolean') {
    throw new ValidationError(`Le champ ${fieldName} ne peut pas être un booléen.`);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError(`Le champ ${fieldName} doit être un nombre fini.`);
    }
    return value;
  }
  if (typeof value === 'string') {
    if (!PLAIN_DECIMAL_REGEX.test(value)) {
      throw new ValidationError(`Le champ ${fieldName} doit être un nombre décimal valide.`);
    }
    const n = Number(value.trim());
    if (!Number.isFinite(n)) {
      throw new ValidationError(`Le champ ${fieldName} doit être un nombre fini.`);
    }
    return n;
  }
  throw new ValidationError(`Le champ ${fieldName} doit être un nombre valide.`);
}

/**
 * Validates that value is a finite number strictly greater than 0.
 */
export function requireFinitePositive(value: unknown, fieldName: string): number {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    throw new ValidationError(`Le champ ${fieldName} est obligatoire et doit être supérieur à zéro.`);
  }
  const n = parsePlainDecimal(value, fieldName);
  if (n <= 0) {
    throw new ValidationError(`Le champ ${fieldName} doit être un nombre strictement positif (> 0).`);
  }
  return n;
}

/**
 * Validates that value is a finite number greater than or equal to 0.
 */
export function requireFiniteNonNegative(
  value: unknown,
  fieldName: string,
  defaultValue?: number
): number {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new ValidationError(`Le champ ${fieldName} est obligatoire et doit être positif ou nul.`);
  }
  const n = parsePlainDecimal(value, fieldName);
  if (n < 0) {
    throw new ValidationError(`Le champ ${fieldName} doit être un nombre positif ou nul (>= 0).`);
  }
  return n;
}

/**
 * Validates that an optional value, if provided, is finite and > 0.
 * If undefined, null or empty/whitespace string, returns undefined.
 */
export function requireOptionalFinitePositive(
  value: unknown,
  fieldName: string
): number | undefined {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return undefined;
  }
  const n = parsePlainDecimal(value, fieldName);
  if (n <= 0) {
    throw new ValidationError(`Le champ ${fieldName} doit être un nombre strictement positif (> 0).`);
  }
  return n;
}

/**
 * Validates that an optional value, if provided, is finite and >= 0.
 * If undefined, null or empty/whitespace string, returns undefined.
 */
export function requireOptionalFiniteNonNegative(
  value: unknown,
  fieldName: string
): number | undefined {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return undefined;
  }
  const n = parsePlainDecimal(value, fieldName);
  if (n < 0) {
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
