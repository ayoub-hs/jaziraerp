import { describe, it, expect } from 'vitest';
import { businessDateISO, businessDateKey } from './businessDate.js';

describe('businessDate (Africa/Tunis)', () => {
  it('rolls to the next day at 23:30 UTC (= 00:30 Tunis)', () => {
    const d = new Date('2026-01-15T23:30:00.000Z');
    expect(d.toISOString().slice(0, 10)).toBe('2026-01-15'); // UTC still previous day
    expect(businessDateISO(d)).toBe('2026-01-16');
    expect(businessDateKey(d)).toBe('20260116');
  });

  it('stays on the same day at 00:30 Tunis (= 23:30 UTC previous day)', () => {
    const d = new Date('2026-01-15T22:30:00.000Z'); // 23:30 Tunis, same calendar day
    expect(businessDateISO(d)).toBe('2026-01-15');
    expect(businessDateKey(d)).toBe('20260115');
  });

  it('agrees with UTC midday (no boundary effect)', () => {
    const d = new Date('2026-06-10T12:00:00.000Z');
    expect(businessDateISO(d)).toBe('2026-06-10');
  });
});
