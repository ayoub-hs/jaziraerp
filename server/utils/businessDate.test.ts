import { describe, it, expect } from 'vitest';
import { businessDateISO, businessDateKey, tunisDayRangeUTC } from './businessDate.js';

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

  it('converts a Tunis day to the UTC range covering it', () => {
    // Tunis is UTC+1: Tunis 2026-01-16 spans 2026-01-15T23:00Z..2026-01-16T23:00Z
    expect(tunisDayRangeUTC('2026-01-16')).toEqual({
      start: '2026-01-15T23:00:00.000Z',
      end: '2026-01-16T23:00:00.000Z'
    });
  });

  it('places 23:30 UTC in the next Tunis day and 22:30 UTC in the same day', () => {
    const next = tunisDayRangeUTC('2026-01-16');
    expect('2026-01-15T23:30:00.000Z' >= next.start).toBe(true);
    expect('2026-01-15T23:30:00.000Z' < next.end).toBe(true);

    const same = tunisDayRangeUTC('2026-01-15');
    expect('2026-01-15T22:30:00.000Z' >= same.start).toBe(true);
    expect('2026-01-15T22:30:00.000Z' < same.end).toBe(true);
    expect('2026-01-15T23:30:00.000Z' >= same.start).toBe(true);
    expect('2026-01-15T23:30:00.000Z' < same.end).toBe(false);
  });
});
