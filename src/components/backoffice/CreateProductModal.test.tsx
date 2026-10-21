// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateProductModal } from './CreateProductModal';
import type { ProductFamily, Formulation } from '../../types/index.js';

describe('CreateProductModal - size_volume, packaging lines & live costing', () => {
  const mockFamilies: ProductFamily[] = [
    {
      id: 'fam-mfg-1',
      name: 'Liquide Vaisselle',
      category: 'Detergents',
      type: 'MANUFACTURED',
      formulation_id: 'form-1',
      active: 1
    },
    {
      id: 'fam-resale-1',
      name: 'Microfibre',
      category: 'Accessoires',
      type: 'RESALE',
      active: 1
    }
  ];

  const mockFormulations: Formulation[] = [
    {
      id: 'form-1',
      name: 'Formule Vaisselle 100L',
      base_volume: 100,
      cost_per_liter: 0.800,
      total_batch_cost: 80.000,
      items: []
    }
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/settings/shop')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ default_retail_markup_percent: '30', default_wholesale_markup_percent: '20' })
        });
      }
      if (url.includes('/api/categories')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([])
        });
      }
      if (url.includes('/api/materials')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: 'mat-bot', name: 'Bouteille 1.5L', category: 'bottle', unit: 'pcs', latest_purchase_cost: 0.350 },
            { id: 'mat-cap', name: 'Bouchon 28mm', category: 'cap', unit: 'pcs', latest_purchase_cost: 0.050 }
          ])
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });
  });

  it('renders size_volume and packaging lines editor for MANUFACTURED products and shows live cost', async () => {
    render(
      <CreateProductModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        families={mockFamilies}
        formulations={mockFormulations}
        containerTypes={[]}
      />
    );

    // Default mode is NEW_FAMILY with familyType = MANUFACTURED
    await waitFor(() => {
      expect(screen.getByText(/Volume \/ Poids unitaire/i)).toBeTruthy();
      expect(screen.getByText(/Emballage spécifique de l'article/i)).toBeTruthy();
      expect(screen.getByText(/Coût de revient unitaire calculé/i)).toBeTruthy();
    });
  });

  it('updates live cost calculation when size_volume changes', async () => {
    render(
      <CreateProductModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        families={mockFamilies}
        formulations={mockFormulations}
        containerTypes={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/Volume \/ Poids unitaire/i)).toBeTruthy();
    });

    const volInput = screen.getByLabelText(/Volume \/ Poids unitaire/i);
    fireEvent.change(volInput, { target: { value: '2.0' } });

    // With bulk 0.800/L * 2.0 = 1.600 DT (appears in both total display and formula breakdown)
    await waitFor(() => {
      const matches = screen.getAllByText(/1.600 DT/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('allows adding and removing packaging lines and updates calculated live cost', async () => {
    render(
      <CreateProductModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        families={mockFamilies}
        formulations={mockFormulations}
        containerTypes={[]}
      />
    );

    // Set volume to 1.0L -> bulk cost = 0.800 DT
    await waitFor(() => {
      expect(screen.getByText(/Emballage spécifique de l'article/i)).toBeTruthy();
      expect(screen.getByLabelText(/Sélectionner un article d'emballage/i)).toBeTruthy();
    });

    const volInput = screen.getByLabelText(/Volume \/ Poids unitaire/i);
    fireEvent.change(volInput, { target: { value: '1.0' } });

    // Select 'mat-bot' (Bouteille 1.5L @ 0.350 DT)
    const matSelect = screen.getByLabelText(/Sélectionner un article d'emballage/i);
    fireEvent.change(matSelect, { target: { value: 'mat-bot' } });

    const addBtn = screen.getByRole('button', { name: /Ajouter cet emballage/i });
    fireEvent.click(addBtn);

    // Cost should now be 0.800 + 0.350 = 1.150 DT
    await waitFor(() => {
      const matches = screen.getAllByText(/1.150 DT/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Bouteille 1.5L')).toBeTruthy();
    });
  });

  it('starts size_volume empty and displays "—" for live unit cost when empty', async () => {
    render(
      <CreateProductModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        families={mockFamilies}
        formulations={mockFormulations}
        containerTypes={[]}
      />
    );

    await waitFor(() => {
      const volInput = screen.getByLabelText(/Volume \/ Poids unitaire/i) as HTMLInputElement;
      expect(volInput.value).toBe('');
      // Live cost card shows "—" when size is empty
      expect(screen.getByTestId('live-unit-cost-display') || screen.getByText(/—/)).toBeTruthy();
    });
  });

  it('editing a manufactured product with NULL size_volume shows "size manquante" and blocks submit without sending size_volume 1', async () => {
    const mockNullSizeProduct = {
      id: 'prod-null-size',
      family_id: 'fam-mfg-1',
      name: 'Produit Sans Taille',
      product_type: 'MANUFACTURED' as const,
      size_label: 'Custom',
      size_volume: null,
      barcode: '1234567890123',
      stock_quantity: 10,
      low_stock_threshold: 5,
      retail_price: 5.0,
      wholesale_price: 4.0,
      cost_reference: 2.0,
      active: 1
    };

    const fetchSpy = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/settings/shop')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ default_retail_markup_percent: '30', default_wholesale_markup_percent: '20' })
        });
      }
      if (url.includes('/api/categories')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url.includes('/api/materials')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url.includes('/api/products/prod-null-size/packaging')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url.includes('/api/products/prod-null-size')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockNullSizeProduct) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = fetchSpy;

    render(
      <CreateProductModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        productToEdit={mockNullSizeProduct as any}
        families={mockFamilies}
        formulations={mockFormulations}
        containerTypes={[]}
      />
    );

    // 1. Must show "size manquante" (or "taille manquante")
    await waitFor(() => {
      expect(screen.getByLabelText(/Volume \/ Poids unitaire/i)).toBeTruthy();
      expect(screen.getAllByText(/size manquante|taille manquante/i).length).toBeGreaterThanOrEqual(1);
    });

    // 2. Volume input is empty
    const volInput = screen.getByLabelText(/Volume \/ Poids unitaire/i) as HTMLInputElement;
    expect(volInput.value).toBe('');

    // 3. Click submit
    const submitBtn = screen.getByRole('button', { name: /mettre à jour l'article/i });
    expect(submitBtn.hasAttribute('disabled')).toBe(true);
    fireEvent.click(submitBtn);

    // 4. Submit must be blocked, fetch must NOT be called with PUT sending size_volume: 1
    await waitFor(() => {
      const putCalls = fetchSpy.mock.calls.filter(([url, opts]) => opts?.method === 'PUT');
      expect(putCalls.length).toBe(0);
    });
  });
});


