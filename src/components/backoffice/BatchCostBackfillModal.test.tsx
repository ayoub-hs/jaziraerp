// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BatchCostBackfillModal } from './BatchCostBackfillModal.js';

describe('BatchCostBackfillModal (Commit 4)', () => {
  const mockCandidates = [
    {
      id: 'prod-15',
      name: 'Liquide Vaisselle 1.5L',
      family_id: 'fam-1',
      family_name: 'Vaisselle',
      size_label: '1.5L',
      size_volume: null,
      suggested_size_volume: 1.5,
      stock_quantity: 20,
      current_cost: 1.000,
      current_valuation: 20.000
    },
    {
      id: 'prod-2',
      name: 'Liquide Vaisselle 2L',
      family_id: 'fam-1',
      family_name: 'Vaisselle',
      size_label: '2 L',
      size_volume: null,
      suggested_size_volume: 2.0,
      stock_quantity: 10,
      current_cost: 1.200,
      current_valuation: 12.000
    }
  ];

  const mockCostItems = [
    {
      id: 'prod-15',
      name: 'Liquide Vaisselle 1.5L',
      family_id: 'fam-1',
      family_name: 'Vaisselle',
      size_label: '1.5L',
      size_volume: 1.5,
      stock_quantity: 20,
      current_cost: 1.000,
      current_valuation: 20.000,
      status: 'ok',
      calculated_cost: 1.680,
      bulk_part: 1.200,
      packaging_part: 0.480,
      new_valuation: 33.600,
      delta_valuation: 13.600
    },
    {
      id: 'prod-null',
      name: 'Produit Sans Taille',
      family_id: 'fam-1',
      family_name: 'Vaisselle',
      size_label: 'Custom',
      size_volume: null,
      stock_quantity: 5,
      current_cost: 1.000,
      current_valuation: 5.000,
      status: 'size_manquante',
      calculated_cost: null,
      bulk_part: null,
      packaging_part: null,
      new_valuation: 5.000,
      delta_valuation: 0.000,
      warning: 'Volume unitaire manquant'
    }
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads backfill candidates, allows volume edit, and submits confirmation', async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/products/backfill-size-preview')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ candidates: mockCandidates, total_candidates: 2 })
        });
      }
      if (url.includes('/api/products/backfill-size-confirm')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            updated_count: 2,
            old_valuation: 32.000,
            new_valuation: 32.000,
            delta_valuation: 0.000
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = fetchSpy;

    const onSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <BatchCostBackfillModal
        isOpen={true}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    // Verify candidates rendered with prefilled suggested volume
    await waitFor(() => {
      expect(screen.getByText('Liquide Vaisselle 1.5L')).toBeTruthy();
      expect(screen.getByText('Liquide Vaisselle 2L')).toBeTruthy();
    });

    const submitBtn = screen.getByRole('button', { name: /enregistrer les tailles/i });
    expect(submitBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(submitBtn);

    await waitFor(() => {
      const confirmCall = fetchSpy.mock.calls.find(([url]) => url.includes('/api/products/backfill-size-confirm'));
      expect(confirmCall).toBeDefined();
      const body = JSON.parse(confirmCall![1].body);
      expect(body.items).toHaveLength(2);
      expect(body.items[0]).toEqual({ id: 'prod-15', size_volume: 1.5 });
      expect(body.items[1]).toEqual({ id: 'prod-2', size_volume: 2.0 });
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('switches to batch cost preview tab, shows valuation delta, and confirms cost update', async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/products/backfill-size-preview')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ candidates: [], total_candidates: 0 })
        });
      }
      if (url.includes('/api/products/batch-cost-preview')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            items: mockCostItems,
            total_products: 2,
            total_current_valuation: 25.000,
            total_projected_valuation: 38.600,
            total_delta_valuation: 13.600
          })
        });
      }
      if (url.includes('/api/products/batch-cost-confirm')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            updated_count: 1,
            old_valuation: 20.000,
            new_valuation: 33.600,
            delta_valuation: 13.600
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = fetchSpy;

    const onSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <BatchCostBackfillModal
        isOpen={true}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    // Switch to tab 2: Mise à jour Coûts
    const costTabBtn = screen.getByRole('button', { name: /2\. Mise à Jour Coûts/i });
    fireEvent.click(costTabBtn);

    await waitFor(() => {
      expect(screen.getByText('Liquide Vaisselle 1.5L')).toBeTruthy();
      expect(screen.getByText('Produit Sans Taille')).toBeTruthy();
      expect(screen.getByText(/⚠️ Size manquante/i)).toBeTruthy();
    });

    // Check impact net is displayed
    expect(screen.getAllByText(/\+13\.600 DT/i).length).toBeGreaterThanOrEqual(1);

    // Click confirm costs button
    const applyBtn = screen.getByRole('button', { name: /appliquer les nouveaux coûts/i });
    expect(applyBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(applyBtn);

    await waitFor(() => {
      const confirmCall = fetchSpy.mock.calls.find(([url]) => url.includes('/api/products/batch-cost-confirm'));
      expect(confirmCall).toBeDefined();
      const body = JSON.parse(confirmCall![1].body);
      expect(body.items).toEqual([{ id: 'prod-15', new_cost: 1.680 }]);
      expect(onSuccess).toHaveBeenCalled();
    });
  });
});
