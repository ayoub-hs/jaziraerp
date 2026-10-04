import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAudioContext, playBeep, playErrorBeep, vibrateError, vibrateSuccess } from './audio.js';

describe('Audio & Haptic Feedback Utilities', () => {
  let mockResume: any;
  let mockAudioContextInstances: any[];

  beforeEach(() => {
    mockAudioContextInstances = [];
    mockResume = vi.fn().mockResolvedValue(undefined);

    class MockAudioContext {
      state = 'suspended';
      currentTime = 0;
      destination = {};

      constructor() {
        mockAudioContextInstances.push(this);
      }

      resume = mockResume;

      createOscillator() {
        return {
          type: 'sine',
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn()
        };
      }

      createGain() {
        return {
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn()
          },
          connect: vi.fn()
        };
      }
    }

    vi.stubGlobal('AudioContext', MockAudioContext);
    vi.stubGlobal('window', {
      AudioContext: MockAudioContext
    });
  });

  it('lazily creates a shared AudioContext and resumes it if suspended', () => {
    const ctx1 = getAudioContext();
    expect(ctx1).not.toBeNull();
    expect(mockResume).toHaveBeenCalled();

    const ctx2 = getAudioContext();
    expect(ctx1).toBe(ctx2);
    // Never creates a second AudioContext instance
    expect(mockAudioContextInstances.length).toBe(1);

    expect(() => playBeep()).not.toThrow();
    expect(() => playErrorBeep()).not.toThrow();
    expect(mockAudioContextInstances.length).toBe(1);
  });

  it('triggers haptic feedback via navigator.vibrate when available', () => {
    const mockVibrate = vi.fn();
    vi.stubGlobal('navigator', {
      vibrate: mockVibrate
    });

    vibrateSuccess();
    expect(mockVibrate).toHaveBeenCalledWith(60);

    vibrateError();
    expect(mockVibrate).toHaveBeenCalledWith([150, 60, 150]);
  });
});
