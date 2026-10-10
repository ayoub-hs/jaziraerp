import { describe, it, expect } from 'vitest';
import { validateServerUrl, DEFAULT_SERVER_URL } from './serverUrl.js';

describe('Server URL Validation & HTTPS Enforce Gate', () => {
  it('DEFAULT_SERVER_URL uses https scheme', () => {
    expect(DEFAULT_SERVER_URL.startsWith('https://')).toBe(true);
  });

  it('rejects empty or whitespace URLs', () => {
    const res = validateServerUrl('   ');
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/Veuillez saisir/i);
  });

  it('rejects http:// URLs with a clear French error mentioning https://', () => {
    const res = validateServerUrl('http://192.168.1.10:3000');
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/doit obligatoirement commencer par https:\/\//i);
    expect(res.error).toContain('connexion sécurisée requise');
  });

  it('rejects other non-https protocols', () => {
    const res = validateServerUrl('ftp://my-server.com');
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/https:\/\//);
  });

  it('rejects incomplete https:// without host', () => {
    const res = validateServerUrl('https://');
    expect(res.valid).toBe(false);
  });

  it('accepts valid https URLs (cloud tailnet and LAN with port)', () => {
    expect(validateServerUrl('https://jazicloud.fossa-wrasse.ts.net').valid).toBe(true);
    expect(validateServerUrl('https://192.168.1.50:3000').valid).toBe(true);
    expect(validateServerUrl('https://localhost:3000/').valid).toBe(true);
  });
});
