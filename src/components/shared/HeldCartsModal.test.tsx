// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { HeldCartsModal } from './HeldCartsModal.js';
import { heldCartsService } from '../../services/heldCartsService.js';
import type { CartItem, Product } from '../../types/index.js';

describe('HeldCartsModal (Batch 2 Item B4)', () => {
  const dummyItem: CartItem = {
    cart_item_id: 'cart-1',
    product_id: 'prod-1',
    name: 'Javel 5L',
    unit_price: 5.000,
    quantity: 2,
    pack_multiplier: 1
  };

  const dummyProducts: Product[] = [
    {
      id: 'prod-1',
      family_id: 'fam-1',
      category: 'Detergents',
      name: 'Javel 5L',
      stock_quantity: 100,
      low_stock_threshold: 5,
      cost_reference: 2.000,
      retail_price: 5.000,
      wholesale_price: 4.500,
      active: 1
    }
  ];

  beforeEach(() => {
    localStorage.clear();
    heldCartsService.clearAll();
  });

  it('renders empty state when no held carts', () => {
    render(
      <HeldCartsModal
        isOpen={true}
        onClose={vi.fn()}
        products={dummyProducts}
        currentCartItems={[]}
        currentCustomer={null}
        currentSaleDiscount={0}
        onResumeCart={vi.fn()}
      />
    );

    expect(screen.getByText('Paniers en attente (0)')).toBeTruthy();
    expect(screen.getByText('Aucun panier en attente')).toBeTruthy();
  });

  it('resumes a held cart when current cart is empty', () => {
    const held = heldCartsService.holdCart([dummyItem], null, 0, 'Client Mohamed');
    const onResumeCart = vi.fn();
    const onClose = vi.fn();

    render(
      <HeldCartsModal
        isOpen={true}
        onClose={onClose}
        products={dummyProducts}
        currentCartItems={[]}
        currentCustomer={null}
        currentSaleDiscount={0}
        onResumeCart={onResumeCart}
      />
    );

    expect(screen.getByText('Client Mohamed')).toBeTruthy();
    expect(screen.getByText('Javel 5L')).toBeTruthy();

    const resumeBtn = screen.getByRole('button', { name: /Reprendre ce panier/i });
    fireEvent.click(resumeBtn);

    expect(onResumeCart).toHaveBeenCalledTimes(1);
    expect(onResumeCart.mock.calls[0][0].id).toBe(held.id);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('prompts cashier when current cart already has items', () => {
    const held = heldCartsService.holdCart([dummyItem], null, 0, 'Client Mohamed');
    const onResumeCart = vi.fn();

    render(
      <HeldCartsModal
        isOpen={true}
        onClose={vi.fn()}
        products={dummyProducts}
        currentCartItems={[dummyItem]}
        currentCustomer={null}
        currentSaleDiscount={0}
        onResumeCart={onResumeCart}
      />
    );

    const resumeBtn = screen.getByRole('button', { name: /Reprendre ce panier/i });
    fireEvent.click(resumeBtn);

    // Prompt appears
    expect(screen.getByText(/Panier actif non vide/i)).toBeTruthy();
    expect(screen.getByText(/Mettre l'actuel en attente & Reprendre/i)).toBeTruthy();
    expect(screen.getByText(/Écraser l'actuel/i)).toBeTruthy();

    // Click overwrite
    const overwriteBtn = screen.getByRole('button', { name: /Écraser l'actuel/i });
    fireEvent.click(overwriteBtn);

    expect(onResumeCart).toHaveBeenCalledTimes(1);
  });

  it('deletes a held cart upon confirmation', () => {
    heldCartsService.holdCart([dummyItem], null, 0, 'Client To Delete');

    render(
      <HeldCartsModal
        isOpen={true}
        onClose={vi.fn()}
        products={dummyProducts}
        currentCartItems={[]}
        currentCustomer={null}
        currentSaleDiscount={0}
        onResumeCart={vi.fn()}
      />
    );

    expect(screen.getByText('Client To Delete')).toBeTruthy();

    const deleteBtn = screen.getByRole('button', { name: /Supprimer/i });
    fireEvent.click(deleteBtn);

    expect(screen.getByText('Supprimer ?')).toBeTruthy();
    const confirmYesBtn = screen.getByRole('button', { name: 'Oui' });
    fireEvent.click(confirmYesBtn);

    expect(heldCartsService.getHeldCartCount()).toBe(0);
    expect(screen.queryByText('Client To Delete')).toBeNull();
  });
});
