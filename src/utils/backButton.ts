import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useEffect } from 'react';

export type BackHandler = () => boolean;

const handlers: BackHandler[] = [];
let isListenerAttached = false;

/**
 * Register a back button handler. Returns an unregister function.
 * Handlers are invoked LIFO (topmost modal/drawer first).
 * Handler returning true stops propagation (consumes event).
 */
export function registerBackHandler(handler: BackHandler): () => void {
  handlers.push(handler);
  return () => {
    const idx = handlers.lastIndexOf(handler);
    if (idx !== -1) {
      handlers.splice(idx, 1);
    }
  };
}

export function getBackHandlersCount(): number {
  return handlers.length;
}

/**
 * Dispatch back button event.
 * If no handler consumes the event, minimize the app without exiting.
 */
export function handleBackButton(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    try {
      const consumed = handlers[i]();
      if (consumed) {
        return true;
      }
    } catch (err) {
      console.warn('[backButton] Handler threw error:', err);
    }
  }

  // Nothing was open to close: minimize the app (do NOT exit)
  if (Capacitor.isNativePlatform()) {
    CapacitorApp.minimizeApp().catch(err => {
      console.warn('[backButton] Failed to minimize app:', err);
    });
  }
  return false;
}

export function initBackButton(): void {
  if (isListenerAttached) return;
  if (typeof window === 'undefined') return;
  if (Capacitor.isNativePlatform()) {
    CapacitorApp.addListener('backButton', () => {
      handleBackButton();
    });
  }
  isListenerAttached = true;
}

export function useBackButton(handler: BackHandler, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    return registerBackHandler(handler);
  }, [enabled, handler]);
}

export function resetBackHandlersForTest(): void {
  handlers.length = 0;
  isListenerAttached = false;
}
