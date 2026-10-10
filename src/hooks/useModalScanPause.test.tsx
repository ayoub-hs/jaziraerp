// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { useModalScanPause } from './useModalScanPause.js';
import { scannerService } from '../services/hardware/scanner.js';

function TestModal({ isOpen }: { isOpen: boolean }) {
  useModalScanPause(isOpen);
  return <div>Modal Content</div>;
}

describe('useModalScanPause Hook (Batch 2 Item A1)', () => {
  beforeEach(() => {
    scannerService.resetPause();
  });

  it('pauses scanner while open and resumes when closed', () => {
    expect(scannerService.isPaused()).toBe(false);

    const { rerender } = render(<TestModal isOpen={true} />);
    expect(scannerService.isPaused()).toBe(true);
    expect(scannerService.getPauseCount()).toBe(1);

    rerender(<TestModal isOpen={false} />);
    expect(scannerService.isPaused()).toBe(false);
    expect(scannerService.getPauseCount()).toBe(0);
  });

  it('safely resumes when a modal unmounts abruptly', () => {
    expect(scannerService.isPaused()).toBe(false);

    const { unmount } = render(<TestModal isOpen={true} />);
    expect(scannerService.isPaused()).toBe(true);
    expect(scannerService.getPauseCount()).toBe(1);

    // Abrupt unmount
    unmount();
    expect(scannerService.isPaused()).toBe(false);
    expect(scannerService.getPauseCount()).toBe(0);
  });

  it('correctly tracks multiple concurrent open modals', () => {
    function NestedModals() {
      return (
        <>
          <TestModal isOpen={true} />
          <TestModal isOpen={true} />
        </>
      );
    }

    const { unmount } = render(<NestedModals />);
    expect(scannerService.isPaused()).toBe(true);
    expect(scannerService.getPauseCount()).toBe(2);

    unmount();
    expect(scannerService.isPaused()).toBe(false);
    expect(scannerService.getPauseCount()).toBe(0);
  });
});
