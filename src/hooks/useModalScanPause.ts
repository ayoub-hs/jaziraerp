import { useEffect } from 'react';
import { scannerService } from '../services/hardware/scanner.js';

/**
 * Pause barcode scanning while a modal is mounted/open.
 * Driven by an internal pause counter in scannerService:
 * - open -> pause
 * - close -> resume
 * - safe fallback if unmounted abruptly (React effect cleanup resumes)
 */
export function useModalScanPause(isOpen: boolean = true): void {
  useEffect(() => {
    if (!isOpen) return;
    const resume = scannerService.pause();
    return () => {
      resume();
    };
  }, [isOpen]);
}
