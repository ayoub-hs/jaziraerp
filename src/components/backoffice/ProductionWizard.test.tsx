// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Backoffice } from './Backoffice.js';
import { Product, ProductFamily } from '../../types/index.js';

describe('Production Wizard & Batch History UI (GATE 1)', () => {
  const mockFamilies: ProductFamily[] = [
    {
      id: 'fam-dish',
      name: 'Liquide Vaisselle',
      category: 'Detergents',
      type: 'MANUFACTURED',
      formulation_id: 'form-dish',
      active: 1
    }
  ];

  const mockProducts: Product[] = [
    {
      id: 'prod-dish-15l',
      family_id: 'fam-dish',
      category: 'Detergents',
      product_type: 'MANUFACTURED',
      name: 'Vaisselle Citron 1.5L',
      size_label: '1.5L',
      size_volume: 1.5,
      barcode: 'DISH-15L',
      stock_quantity: 10,
      low_stock_threshold: 5,
      cost_reference: 1.680,
      retail_price: 3.500,
      wholesale_price: 3.000,
      active: 1
    },
    {
      id: 'prod-legacy-null-size',
      family_id: 'fam-dish',
      category: 'Detergents',
      product_type: 'MANUFACTURED',
      name: 'Vaisselle Sans Taille',
      size_label: 'Ancien',
      size_volume: null,
      barcode: 'DISH-NULL',
      stock_quantity: 5,
      low_stock_threshold: 5,
      cost_reference: 1.000,
      retail_price: 2.500,
      wholesale_price: 2.000,
      active: 1
    }
  ];

  const mockFormulations = [
    {
      id: 'form-dish',
      name: 'Formule Vaisselle Vrac',
      base_yield_quantity: 100,
      base_yield_unit: 'L',
      cost_per_liter: 0.800,
      cost_per_unit: 0.800
    },
    {
      id: 'form-piece',
      name: 'Formule Savon Solide Pièces',
      base_yield_quantity: 100,
      base_yield_unit: 'pcs',
      cost_per_liter: 0.500,
      cost_per_unit: 0.500
    }
  ];

  const mockBatches = [
    {
      id: 'batch-new',
      batch_number: 'BAT-20261021-0001',
      date: '2026-10-21T10:00:00Z',
      formulation_id: 'form-dish',
      formulation_name: 'Formule Vaisselle Vrac',
      formulation_base_unit: 'L',
      target_product_id: 'prod-dish-15l',
      target_product_name: 'Vaisselle Citron 1.5L',
      size_label: '1.5L',
      batch_volume: 30,
      units_produced: 20,
      cost_per_unit: 1.680,
      total_batch_cost: 33.600
    },
    {
      id: 'batch-legacy',
      batch_number: 'BAT-LEGACY-0001',
      date: '2026-01-01T10:00:00Z',
      formulation_id: 'form-dish',
      formulation_name: 'Formule Vaisselle Vrac',
      formulation_base_unit: 'L',
      target_product_id: 'prod-dish-15l',
      target_product_name: 'Vaisselle Citron 1.5L',
      size_label: '1.5L',
      batch_volume: null, // Legacy batch with NULL volume
      units_produced: 10,
      cost_per_unit: 1.500,
      total_batch_cost: 15.000
    }
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders batch volume with formulation unit and "—" for legacy null volume, never showing undefinedL', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/formulations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockFormulations) });
      }
      if (url.includes('/api/production/batches')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockBatches) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    render(
      <Backoffice
        products={mockProducts}
        families={mockFamilies}
        customers={[]}
        containerTypes={[]}
        onRefreshData={vi.fn()}
      />
    );

    // Switch to PRODUCTION tab
    const prodTabBtn = screen.getByRole('button', { name: /^Production$/i });
    fireEvent.click(prodTabBtn);

    await waitFor(() => {
      expect(screen.getByText('BAT-20261021-0001')).toBeTruthy();
      expect(screen.getByText('BAT-LEGACY-0001')).toBeTruthy();
    });

    // Check new batch renders volume with unit: "30 L"
    expect(screen.getByText('30 L')).toBeTruthy();

    // Check legacy batch with null volume renders "—"
    expect(screen.getByText('—')).toBeTruthy();

    // Assert that "undefinedL" does NOT appear anywhere
    expect(screen.queryByText(/undefinedL/i)).toBeNull();
  });

  it('derives units from volume and volume from units in production wizard, showing size volume used', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/formulations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockFormulations) });
      }
      if (url.includes('/api/production/batches')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    render(
      <Backoffice
        products={mockProducts}
        families={mockFamilies}
        customers={[]}
        containerTypes={[]}
        onRefreshData={vi.fn()}
      />
    );

    // Switch to PRODUCTION tab
    const prodTabBtn = screen.getByRole('button', { name: /^Production$/i });
    fireEvent.click(prodTabBtn);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Formule Vaisselle Vrac/i })).toBeTruthy();
    });

    // Select formulation
    const formSelect = screen.getByRole('combobox', { name: /1\. Sélectionner la Recette/i });
    fireEvent.change(formSelect, { target: { value: 'form-dish' } });

    // Select target product with size_volume: 1.5
    const prodSelect = screen.getByRole('combobox', { name: /Article Produit à Réapprovisionner/i });
    fireEvent.change(prodSelect, { target: { value: 'prod-dish-15l' } });

    // Check size volume used is displayed
    expect(screen.getByText(/1\.5 L/i)).toBeTruthy();

    // Find volume and units inputs
    const volInput = screen.getByLabelText(/Volume du Lot/i);
    const unitsInput = screen.getByLabelText(/Unités Produites/i);

    // 1. Derivation units -> volume: units 200 * size 1.5 = volume 300
    fireEvent.change(unitsInput, { target: { value: '200' } });
    expect((volInput as HTMLInputElement).value).toBe('300');

    // 2. Derivation volume -> units: volume 150 / size 1.5 = units 100
    fireEvent.change(volInput, { target: { value: '150' } });
    expect((unitsInput as HTMLInputElement).value).toBe('100');

    // 3. Derivation volume -> units: volume 300 / size 1.5 = units 200
    fireEvent.change(volInput, { target: { value: '300' } });
    expect((unitsInput as HTMLInputElement).value).toBe('200');
  });

  it('allows piece-based formulation with NULL size_volume, displaying "Format unitaire utilisé : 1" and keeping submit enabled', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/formulations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockFormulations) });
      }
      if (url.includes('/api/production/batches')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    render(
      <Backoffice
        products={mockProducts}
        families={mockFamilies}
        customers={[]}
        containerTypes={[]}
        onRefreshData={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^Production$/i }));

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Formule Savon Solide Pièces/i })).toBeTruthy();
    });

    // Select piece formulation (base_yield_unit: 'pcs')
    const formSelect = screen.getByRole('combobox', { name: /1\. Sélectionner la Recette/i });
    fireEvent.change(formSelect, { target: { value: 'form-piece' } });

    // Select product with size_volume: null
    const prodSelect = screen.getByRole('combobox', { name: /Article Produit à Réapprovisionner/i });
    fireEvent.change(prodSelect, { target: { value: 'prod-legacy-null-size' } });

    // Must show "Format unitaire utilisé : 1"
    expect(screen.getByText(/Format unitaire utilisé : 1/i)).toBeTruthy();

    // Must NOT show missing size warning
    expect(screen.queryByText(/Format manquant : cet article n'a aucun volume unitaire configuré/i)).toBeNull();

    // Submit button must remain enabled
    const submitBtn = screen.getByRole('button', { name: /Lancer la Production du Lot/i });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(false);

    // Derivation with piece recipe: volume 50 -> units 50, units 100 -> volume 100
    const volInput = screen.getByLabelText(/Volume du Lot/i);
    const unitsInput = screen.getByLabelText(/Unités Produites/i);

    fireEvent.change(volInput, { target: { value: '50' } });
    expect((unitsInput as HTMLInputElement).value).toBe('50');

    fireEvent.change(unitsInput, { target: { value: '100' } });
    expect((volInput as HTMLInputElement).value).toBe('100');
  });

  it('shows missing size warning with link to Tailles & Coûts when product has no size_volume on non-piece formulation', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/formulations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockFormulations) });
      }
      if (url.includes('/api/production/batches')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    render(
      <Backoffice
        products={mockProducts}
        families={mockFamilies}
        customers={[]}
        containerTypes={[]}
        onRefreshData={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^Production$/i }));

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Formule Vaisselle Vrac/i })).toBeTruthy();
    });

    const formSelect = screen.getByRole('combobox', { name: /1\. Sélectionner la Recette/i });
    fireEvent.change(formSelect, { target: { value: 'form-dish' } });

    const prodSelect = screen.getByRole('combobox', { name: /Article Produit à Réapprovisionner/i });
    fireEvent.change(prodSelect, { target: { value: 'prod-legacy-null-size' } });

    // Should display missing size warning and link/button to Tailles & Coûts
    expect(screen.getByText(/Format manquant.*aucun volume unitaire configuré/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tailles & Coûts/i })).toBeTruthy();

    // Submit button must be disabled for non-piece formulation with NULL size_volume
    const submitBtn = screen.getByRole('button', { name: /Lancer la Production du Lot/i });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('displays API French 400 error message on volume/units mismatch', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/formulations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockFormulations) });
      }
      if (url.includes('/api/production/batches') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({
            error: "Incohérence : le volume déclaré (50) ne correspond pas aux unités produites (20 × 1.5 = 30)."
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    render(
      <Backoffice
        products={mockProducts}
        families={mockFamilies}
        customers={[]}
        containerTypes={[]}
        onRefreshData={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^Production$/i }));

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Formule Vaisselle Vrac/i })).toBeTruthy();
    });

    fireEvent.change(screen.getByRole('combobox', { name: /1\. Sélectionner la Recette/i }), {
      target: { value: 'form-dish' }
    });
    fireEvent.change(screen.getByRole('combobox', { name: /Article Produit à Réapprovisionner/i }), {
      target: { value: 'prod-dish-15l' }
    });

    // Click submit
    fireEvent.click(screen.getByRole('button', { name: /Lancer la Production du Lot/i }));

    await waitFor(() => {
      expect(screen.getByText(/Incohérence : le volume déclaré \(50\) ne correspond pas aux unités produites/i)).toBeTruthy();
    });
  });

  it('displays negative_stock_warnings with material name, required, available, deficit, unit in French for chemicals and packaging', async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/formulations')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockFormulations) });
      }
      if (url.includes('/api/production/batches') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({
            id: 'batch-test-neg',
            batch_number: 'BAT-20261021-0099',
            total_batch_cost: 33.600,
            cost_per_unit: 1.680,
            units_produced: 20,
            negative_stock_warnings: [
              {
                material_id: 'mat-pkg-bottle',
                material_name: 'Bouteille 1.5L',
                current_stock: 5,
                quantity_required: 20,
                deficit: 15,
                unit: 'pcs'
              },
              {
                material_id: 'mat-chem-acid',
                material_name: 'Acide Citrique',
                current_stock: 2,
                quantity_required: 6,
                deficit: 4,
                unit: 'kg'
              }
            ]
          })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    render(
      <Backoffice
        products={mockProducts}
        families={mockFamilies}
        customers={[]}
        containerTypes={[]}
        onRefreshData={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^Production$/i }));

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Formule Vaisselle Vrac/i })).toBeTruthy();
    });

    fireEvent.change(screen.getByRole('combobox', { name: /1\. Sélectionner la Recette/i }), {
      target: { value: 'form-dish' }
    });
    fireEvent.change(screen.getByRole('combobox', { name: /Article Produit à Réapprovisionner/i }), {
      target: { value: 'prod-dish-15l' }
    });

    const form = screen.getByRole('button', { name: /Lancer la Production du Lot/i }).closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText('Lot fabriqué avec succès !')).toBeTruthy();
      // Packaging material warning
      const pkgWarning = screen.getByText('Bouteille 1.5L').closest('div')!;
      expect(pkgWarning.textContent).toContain('Requis 20 pcs, Disponible 5 pcs (Déficit : 15 pcs)');

      // Chemical material warning
      const chemWarning = screen.getByText('Acide Citrique').closest('div')!;
      expect(chemWarning.textContent).toContain('Requis 6 kg, Disponible 2 kg (Déficit : 4 kg)');
    });
  });
});
