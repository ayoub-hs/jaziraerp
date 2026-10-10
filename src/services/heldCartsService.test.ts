// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { heldCartsService } from './heldCartsService.js';
import type { CartItem, Customer, Product } from '../types/index.js';

describe('heldCartsService (Batch 2 Item B4)', () => {
  const dummyItem: CartItem = {
    cart_item_id: 'cart-1',
    product_id: 'prod-1',
    name: 'Javel 5L',
    unit_price: 5.000,
    quantity: 2,
    pack_multiplier: 1
  };

  const dummyCustomer: Customer = {
    id: 'cust-1',
    name: 'Ste Sfax Distribution',
    type: 'WHOLESALE',
    reseller_discount_percent: 0,
    wallet_balance: 0
  };

  const dummyProduct: Product = {
    id: 'prod-1',
    family_id: 'fam-1',
    category: 'Detergents',
    name: 'Javel 5L',
    stock_quantity: 100,
    low_stock_threshold: 5,
    cost_reference: 2.000,
    retail_price: 6.000,
    wholesale_price: 5.000,
    active: 1
  };

  beforeEach(() => {
    localStorage.clear();
    heldCartsService.clearAll();
  });

  it('holds a cart and persists it in localStorage', () => {
    expect(heldCartsService.getHeldCartCount()).toBe(0);

    const held = heldCartsService.holdCart([dummyItem], dummyCustomer, 2.000);
    expect(held.id).toMatch(/^held-/);
    expect(held.items).toHaveLength(1);
    expect(held.items[0].name).toBe('Javel 5L');
    expect(held.customer?.name).toBe('Ste Sfax Distribution');
    expect(held.saleDiscount).toBe(2.000);
    expect(heldCartsService.getHeldCartCount()).toBe(1);

    // Verify localStorage persistence
    const reloaded = heldCartsService.getHeldCarts();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].id).toBe(held.id);
  });

  it('rejects holding an empty cart', () => {
    expect(() => heldCartsService.holdCart([], null)).toThrow(/panier vide/i);
  });

  it('caps held carts at maximum 10 and throws on 11th', () => {
    for (let i = 1; i <= 10; i++) {
      heldCartsService.holdCart([dummyItem], null, 0, `Cart #${i}`);
    }
    expect(heldCartsService.getHeldCartCount()).toBe(10);

    expect(() => heldCartsService.holdCart([dummyItem], null, 0, 'Cart #11')).toThrow(/Limite de 10 paniers/i);
  });

  it('resumes a cart by id and removes it from held list', () => {
    const held = heldCartsService.holdCart([dummyItem], dummyCustomer);
    expect(heldCartsService.getHeldCartCount()).toBe(1);

    const resumed = heldCartsService.resumeCart(held.id);
    expect(resumed).not.toBeNull();
    expect(resumed?.id).toBe(held.id);
    expect(resumed?.customer?.name).toBe('Ste Sfax Distribution');
    expect(heldCartsService.getHeldCartCount()).toBe(0);

    // Resuming again returns null
    expect(heldCartsService.resumeCart(held.id)).toBeNull();
  });

  it('deletes a held cart without resuming', () => {
    const held1 = heldCartsService.holdCart([dummyItem], null, 0, 'Cart 1');
    const held2 = heldCartsService.holdCart([dummyItem], null, 0, 'Cart 2');
    expect(heldCartsService.getHeldCartCount()).toBe(2);

    const deleted = heldCartsService.deleteCart(held1.id);
    expect(deleted).toBe(true);
    expect(heldCartsService.getHeldCartCount()).toBe(1);
    expect(heldCartsService.getHeldCarts()[0].id).toBe(held2.id);
  });

  it('dispatches held-carts-changed window event on operations', () => {
    const listener = vi.fn();
    window.addEventListener('held-carts-changed', listener);

    const held = heldCartsService.holdCart([dummyItem], null);
    expect(listener).toHaveBeenCalledTimes(1);

    heldCartsService.resumeCart(held.id);
    expect(listener).toHaveBeenCalledTimes(2);

    window.removeEventListener('held-carts-changed', listener);
  });

  it('detects catalog price discrepancies on resume', () => {
    // Cart held with wholesale unit_price = 5.000
    const held = heldCartsService.holdCart([dummyItem], dummyCustomer);

    // Product price changes in catalog (wholesale increases to 5.500)
    const updatedProducts: Product[] = [
      {
        ...dummyProduct,
        wholesale_price: 5.500
      }
    ];

    const discrepancies = heldCartsService.checkPriceDiscrepancies(held, updatedProducts);
    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0].productName).toBe('Javel 5L');
    expect(discrepancies[0].oldPrice).toBe(5.000);
    expect(discrepancies[0].newPrice).toBe(5.500);
  });

  it('ignores price discrepancies for overridden and quick add items', () => {
    const overriddenItem: CartItem = {
      ...dummyItem,
      cart_item_id: 'cart-ov',
      unit_price: 3.000,
      price_overridden: true
    };
    const quickAddItem: CartItem = {
      cart_item_id: 'cart-qa',
      name: 'Custom Service',
      unit_price: 10.000,
      quantity: 1,
      pack_multiplier: 1,
      is_quick_add: true
    };

    const held = heldCartsService.holdCart([overriddenItem, quickAddItem], null);

    const updatedProducts: Product[] = [
      {
        ...dummyProduct,
        retail_price: 7.000
      }
    ];

    const discrepancies = heldCartsService.checkPriceDiscrepancies(held, updatedProducts);
    expect(discrepancies).toHaveLength(0);
  });
});
