// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PreparationSlipModal } from './PreparationSlipModal';
import type { ClientOrder } from '../../types';

describe('PreparationSlipModal (Phase 1a Step 5d)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockOrder: ClientOrder = {
    id: 'order-slip-1',
    order_number: 'CMD-20261022-0088',
    customer_id: 'cust-1',
    customer_name: 'Hôtel Les Palmiers',
    guest_name: null,
    phone: '75123456',
    delivery_zone_id: 'zone-1',
    delivery_zone_name: 'Zone Touristique Midoun',
    delivery_address: 'Boulevard de l’Environnement, Midoun',
    expected_delivery_date: '2026-10-23',
    payment_preference: 'CHECK',
    notes: 'Livraison porte arrière quai de déchargement',
    status: 'CONFIRMED',
    delivery_fee: 5.0,
    subtotal_ttc: 90.0,
    total_ttc: 95.0,
    created_at: '2026-10-22T08:30:00Z',
    updated_at: '2026-10-22T08:30:00Z',
    items: [
      {
        id: 'item-1',
        order_id: 'order-slip-1',
        product_id: 'prod-1',
        product_name: 'Eau de Javel 5L',
        size_label: '5L',
        ordered_quantity: 10,
        unit_price_ttc: 3.5,
        total_line_ttc: 35.0
      },
      {
        id: 'item-2',
        order_id: 'order-slip-1',
        product_id: 'prod-2',
        product_name: 'Dégraissant Sol 5L',
        size_label: '5L',
        ordered_quantity: 4,
        unit_price_ttc: 15.0,
        total_line_ttc: 60.0
      }
    ],
    containers_requested: [
      {
        container_type_id: 'ct-1',
        container_name: 'Bidon 5L Vierge',
        quantity: 14
      }
    ]
  };

  it('renders all required preparation details without prices', () => {
    render(
      <PreparationSlipModal
        isOpen={true}
        onClose={vi.fn()}
        order={mockOrder}
      />
    );

    // Order number
    expect(screen.getAllByText(/CMD-20261022-0088/)).toHaveLength(2);
    // Customer, Phone, Address, Zone
    expect(screen.getByText('Hôtel Les Palmiers')).toBeDefined();
    expect(screen.getByText(/75123456/)).toBeDefined();
    expect(screen.getByText(/Boulevard de l’Environnement, Midoun/)).toBeDefined();
    expect(screen.getByText(/Zone Touristique Midoun/)).toBeDefined();

    // Items and quantities
    expect(screen.getByText('Eau de Javel 5L')).toBeDefined();
    expect(screen.getByText('10')).toBeDefined();
    expect(screen.getByText('Dégraissant Sol 5L')).toBeDefined();
    expect(screen.getByText('4')).toBeDefined();

    // Containers requested
    expect(screen.getByText(/Bidon 5L Vierge/)).toBeDefined();
    expect(screen.getByText('14')).toBeDefined();

    // Notes
    expect(screen.getByText(/Livraison porte arrière quai de déchargement/)).toBeDefined();

    // Signature box
    expect(screen.getByText(/Signature et visa préparation/i)).toBeDefined();

    // No prices shown on preparation slip
    expect(screen.queryByText(/Total TTC/i)).toBeNull();
    expect(screen.queryByText(/35\.000 DT|35,000 DT/)).toBeNull();
    expect(screen.queryByText(/95\.000 DT|95,000 DT/)).toBeNull();
  });

  it('triggers window.print when clicking print button', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    render(
      <PreparationSlipModal
        isOpen={true}
        onClose={vi.fn()}
        order={mockOrder}
      />
    );

    const printBtn = screen.getByRole('button', { name: /imprimer la fiche/i });
    fireEvent.click(printBtn);

    expect(printSpy).toHaveBeenCalledTimes(1);
  });
});
