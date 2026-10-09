import { registerPlugin, Capacitor } from '@capacitor/core';

export interface KeepScreenPluginInterface {
  keepOn(): Promise<void>;
  allowSleep(): Promise<void>;
}

export const KeepScreen = registerPlugin<KeepScreenPluginInterface>('KeepScreen');

let isSessionActive = false;
let isScreenKeptOn = false;

export function isSessionActiveState(): boolean {
  return isSessionActive;
}

export function isScreenKeptOnState(): boolean {
  return isScreenKeptOn;
}

export async function setKeepScreenOn(enable: boolean): Promise<void> {
  if (typeof window === 'undefined' || !Capacitor.isNativePlatform()) {
    isScreenKeptOn = enable;
    return;
  }
  try {
    if (enable) {
      await KeepScreen.keepOn();
      isScreenKeptOn = true;
    } else {
      await KeepScreen.allowSleep();
      isScreenKeptOn = false;
    }
  } catch (err) {
    console.warn('[KeepScreen] Failed to update screen keep-on flag:', err);
  }
}

export function updateRegisterSessionState(active: boolean): void {
  isSessionActive = active;
  const isHidden = typeof document !== 'undefined' && document.hidden;
  if (!isHidden && isSessionActive) {
    setKeepScreenOn(true);
  } else {
    setKeepScreenOn(false);
  }
}

export function handleVisibilityChange(): void {
  const isHidden = typeof document !== 'undefined' && document.hidden;
  if (isHidden) {
    // Release screen keep-on immediately when backgrounded
    setKeepScreenOn(false);
  } else if (isSessionActive) {
    // Re-acquire only if register session is open
    setKeepScreenOn(true);
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', handleVisibilityChange);
}
