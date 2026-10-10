import { describe, it, expect } from 'vitest';
import {
  getProductPriceForCustomer,
  getProductPackPrice,
  calculateCartTotals,
  validateSplitPayment,
  buildPaymentPayload,
  parseSizeToLiters,
  calculateContainersNeeded,
  recalculateCartForCustomer,
  getPriceSourceLabel
} from './cart.js';
import type { Customer, Product, CartItem, PackSize } from '../types/index.js';

describe('Cart Utilities', () => {
  const dummyProduct: Product = {
    id: 'prod-1',
    family_id: 'fam-1',
    category: 'Detergents',
    name: 'Dish Soap 1L',
    stock_quantity: 50,
    low_stock_threshold: 5,
    cost_reference: 1.200,
    retail_price: 3.500,
    wholesale_price: 2.800,
    active: 1
  };

  describe('getProductPriceForCustomer', () => {
    it('returns retail price for walk-in / null customer', () => {
      expect(getProductPriceForCustomer(dummyProduct, null)).toBe(3.500);
    });

    it('returns retail price for RETAIL customer', () => {
      const cust: Customer = {
        id: 'c1',
        name: 'Retail Joe',
        type: 'RETAIL',
        reseller_discount_percent: 0,
        wallet_balance: 0
      };
      expect(getProductPriceForCustomer(dummyProduct, cust)).toBe(3.500);
    });

    it('returns wholesale price for WHOLESALE customer', () => {
      const cust: Customer = {
        id: 'c2',
        name: 'Supermarket Wholesale',
        type: 'WHOLESALE',
        reseller_discount_percent: 0,
        wallet_balance: 0
      };
      expect(getProductPriceForCustomer(dummyProduct, cust)).toBe(2.800);
    });

    it('applies negotiated discount off wholesale price for RESELLER customer', () => {
      const cust: Customer = {
        id: 'c3',
        name: 'Reseller Ahmed',
        type: 'RESELLER',
        reseller_discount_percent: 10, // 10% off 2.800 = 2.520
        wallet_balance: 0
      };
      expect(getProductPriceForCustomer(dummyProduct, cust)).toBe(2.520);
    });
  });

  describe('getProductPackPrice', () => {
    const packSizeWithOverride: PackSize = {
      id: 'pack-6',
      product_id: 'prod-1',
      pack_label: 'Carton 6x1L',
      multiplier: 6,
      price_override: 19.500
    };

    const packSizeWithoutOverride: PackSize = {
      id: 'pack-12',
      product_id: 'prod-1',
      pack_label: 'Carton 12x1L',
      multiplier: 12,
      price_override: null
    };

    it('uses price_override for walk-in / null customer', () => {
      // 6 * 3.500 = 21.000, but override is 19.500
      expect(getProductPackPrice(dummyProduct, null, packSizeWithOverride, 6)).toBe(19.500);
    });

    it('uses price_override for RETAIL customer', () => {
      const retailCustomer: Customer = {
        id: 'c1',
        name: 'Retail Joe',
        type: 'RETAIL',
        reseller_discount_percent: 0,
        wallet_balance: 0
      };
      expect(getProductPackPrice(dummyProduct, retailCustomer, packSizeWithOverride, 6)).toBe(19.500);
    });

    it('ignores price_override and uses wholesale price * multiplier for WHOLESALE customer', () => {
      const wholesaleCustomer: Customer = {
        id: 'c2',
        name: 'Supermarket Wholesale',
        type: 'WHOLESALE',
        reseller_discount_percent: 0,
        wallet_balance: 0
      };
      // wholesale price 2.800 * 6 = 16.800
      expect(getProductPackPrice(dummyProduct, wholesaleCustomer, packSizeWithOverride, 6)).toBe(16.800);
    });

    it('ignores price_override and applies discount to wholesale price for RESELLER customer', () => {
      const resellerCustomer: Customer = {
        id: 'c3',
        name: 'Reseller Ahmed',
        type: 'RESELLER',
        reseller_discount_percent: 10, // 2.800 * 0.9 = 2.520
        wallet_balance: 0
      };
      // 2.520 * 6 = 15.120
      expect(getProductPackPrice(dummyProduct, resellerCustomer, packSizeWithOverride, 6)).toBe(15.120);
    });

    it('multiplies base price by pack multiplier when pack has no price override', () => {
      // Retail: 3.500 * 12 = 42.000
      expect(getProductPackPrice(dummyProduct, null, packSizeWithoutOverride, 12)).toBe(42.000);
    });

    it('multiplies base price when packMultiplier > 1 without packSize object', () => {
      // Retail: 3.500 * 4 = 14.000
      expect(getProductPackPrice(dummyProduct, null, null, 4)).toBe(14.000);
    });

    it('returns base price for single item (multiplier = 1, no packSize)', () => {
      expect(getProductPackPrice(dummyProduct, null, null, 1)).toBe(3.500);
    });
  });

  describe('calculateCartTotals', () => {
    it('accurately computes subtotal HT, 19% TVA, and total TTC in 3 decimal places', () => {
      const items: CartItem[] = [
        {
          cart_item_id: 'item-1',
          product_id: 'prod-1',
          name: 'Dish Soap 1L',
          unit_price: 10.000,
          quantity: 1,
          pack_multiplier: 1
        }
      ];

      const totals = calculateCartTotals(items);
      expect(totals.totalTTC).toBe(10.000);
      expect(totals.subtotalHT).toBe(8.403);
      expect(totals.tvaAmount).toBe(1.597);
      expect(totals.subtotalHT + totals.tvaAmount).toBe(totals.totalTTC);
      expect(totals.itemCount).toBe(1);
      expect(totals.totalPieces).toBe(1);
    });

    it('correctly accounts for pack multiplier on total pieces', () => {
      const items: CartItem[] = [
        {
          cart_item_id: 'item-1',
          product_id: 'prod-1',
          name: 'Dish Soap 1L (Pack of 6)',
          unit_price: 20.000,
          quantity: 2,
          pack_multiplier: 6
        }
      ];

      const totals = calculateCartTotals(items);
      expect(totals.totalTTC).toBe(40.000);
      expect(totals.totalPieces).toBe(12); // 2 packs * 6 pcs
    });

    it('correctly applies per-item discount and per-sale discount to calculate net total TTC and TVA', () => {
      const items: CartItem[] = [
        {
          cart_item_id: 'item-1',
          product_id: 'prod-1',
          name: 'Dish Soap 1L',
          unit_price: 10.000,
          quantity: 2, // 20.000 gross
          discount_amount: 2.000, // 18.000 after line discount
          pack_multiplier: 1
        }
      ];

      // 18.000 - 3.000 sale discount = 15.000 TTC
      const totals = calculateCartTotals(items, 3.000);
      expect(totals.rawTotalTTC).toBe(20.000);
      expect(totals.totalDiscount).toBe(5.000); // 2.000 line + 3.000 sale
      expect(totals.totalTTC).toBe(15.000);
      expect(totals.subtotalHT + totals.tvaAmount).toBe(15.000);
      expect(totals.subtotalHT).toBe(12.605);
      expect(totals.tvaAmount).toBe(2.395);
    });
  });

  describe('validateSplitPayment', () => {
    const customerWithWallet: Customer = {
      id: 'c1',
      name: 'Walid',
      type: 'RETAIL',
      reseller_discount_percent: 0,
      wallet_balance: 15.000
    };

    it('rejects if wallet payment exceeds available wallet balance', () => {
      const res = validateSplitPayment(20.000, 0, 16.000, 0, customerWithWallet);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('exceeds available balance');
    });

    it('rejects wallet or credit payment for anonymous walk-in customer', () => {
      const resWallet = validateSplitPayment(20.000, 10.000, 10.000, 0, null);
      expect(resWallet.valid).toBe(false);

      const resCredit = validateSplitPayment(20.000, 10.000, 0, 10.000, null);
      expect(resCredit.valid).toBe(false);
    });

    it('calculates accurate change due on cash overpayment', () => {
      const res = validateSplitPayment(20.000, 30.000, 0, 0, null);
      expect(res.valid).toBe(true);
      expect(res.changeDue).toBe(10.000);
    });

    it('rejects cash tender exceeding max(100 * totalTTC, 1000) (POS-02)', () => {
      // Total 10 DT: max = 1000 DT. Cash 1001 DT should be rejected
      const res1 = validateSplitPayment(10.000, 1001.000, 0, 0, null);
      expect(res1.valid).toBe(false);
      expect(res1.error).toBe('Montant espèces invalide - code-barres scanné ?');

      // Total 20 DT: max = 2000 DT. Cash 2000 DT allowed (with change confirmation), 2001 DT rejected
      const res2 = validateSplitPayment(20.000, 2001.000, 0, 0, null);
      expect(res2.valid).toBe(false);
      expect(res2.error).toBe('Montant espèces invalide - code-barres scanné ?');
    });

    it('rejects outright when integer part of cash has more than 7 digits (POS-02)', () => {
      // 8-digit integer e.g. 10000000 DT
      const res1 = validateSplitPayment(100000.000, 10000000.000, 0, 0, null, { rawCashString: '10000000' });
      expect(res1.valid).toBe(false);
      expect(res1.error).toBe('Montant espèces invalide - code-barres scanné ?');

      // EAN-13 barcode scanned into cash input: 619000100101
      const resBarcode = validateSplitPayment(1500.000, 619000100101, 0, 0, null, { rawCashString: '619000100101' });
      expect(resBarcode.valid).toBe(false);
      expect(resBarcode.error).toBe('Montant espèces invalide - code-barres scanné ?');
    });

    it('requires explicit confirmation when change due exceeds 500.000 DT (POS-02)', () => {
      // Total 10 DT, cash 600 DT -> change due 590 DT > 500 DT
      const resUnconfirmed = validateSplitPayment(10.000, 600.000, 0, 0, null);
      expect(resUnconfirmed.valid).toBe(false);
      expect(resUnconfirmed.changeDue).toBe(590.000);
      expect(resUnconfirmed.requiresHighChangeConfirmation).toBe(true);
      expect(resUnconfirmed.error).toContain('Rendu monnaie supérieur à 500 DT');

      // When explicitly confirmed
      const resConfirmed = validateSplitPayment(10.000, 600.000, 0, 0, null, { highChangeConfirmed: true });
      expect(resConfirmed.valid).toBe(true);
      expect(resConfirmed.changeDue).toBe(590.000);

      // Change due exactly 500 DT (e.g. Total 10 DT, Cash 510 DT) does not require confirmation
      const res500 = validateSplitPayment(10.000, 510.000, 0, 0, null);
      expect(res500.valid).toBe(true);
      expect(res500.changeDue).toBe(500.000);
      expect(res500.requiresHighChangeConfirmation).toBeFalsy();
    });

    it('handles exact split across Cash, Wallet, and Credit', () => {
      // Total 50 DT: 10 Cash, 15 Wallet, 25 Credit
      const res = validateSplitPayment(50.000, 10.000, 15.000, 25.000, customerWithWallet);
      expect(res.valid).toBe(true);
      expect(res.changeDue).toBe(0);
    });
  });

  describe('buildPaymentPayload', () => {
    it('caps applied cash at total when over-tendered (tender 50 on 30)', () => {
      expect(buildPaymentPayload(30.0, 50.0, 0, 0)).toEqual({
        cash_paid: 30.0,
        cash_tendered: 50.0,
        wallet_paid: 0,
        credit_amount: 0
      });
    });

    it('passes through exact tender unchanged', () => {
      expect(buildPaymentPayload(30.0, 30.0, 0, 0)).toEqual({
        cash_paid: 30.0,
        cash_tendered: 30.0,
        wallet_paid: 0,
        credit_amount: 0
      });
    });

    it('deducts wallet before applying cash, keeping tendered for change', () => {
      // Total 30, wallet 10, tender 50 -> applied 20, change 30
      expect(buildPaymentPayload(30.0, 50.0, 10.0, 0)).toEqual({
        cash_paid: 20.0,
        cash_tendered: 50.0,
        wallet_paid: 10.0,
        credit_amount: 0
      });
    });

    it('applies zero cash for wallet+credit only sales', () => {
      expect(buildPaymentPayload(30.0, 0, 10.0, 20.0)).toEqual({
        cash_paid: 0,
        cash_tendered: 0,
        wallet_paid: 10.0,
        credit_amount: 20.0
      });
    });
  });

  describe('parseSizeToLiters', () => {
    it('parses standard liter sizes', () => {
      expect(parseSizeToLiters('10L')).toBe(10);
      expect(parseSizeToLiters('1L')).toBe(1);
      expect(parseSizeToLiters('1.5L')).toBe(1.5);
      expect(parseSizeToLiters('5l')).toBe(5);
      expect(parseSizeToLiters('20 Litres')).toBe(20);
      expect(parseSizeToLiters('Litre')).toBe(1);
    });

    it('parses milliliter sizes into fractional liters', () => {
      expect(parseSizeToLiters('500ml')).toBe(0.5);
      expect(parseSizeToLiters('750 ml')).toBe(0.75);
    });

    it('falls back to product name if size label is not specified or non-volume', () => {
      expect(parseSizeToLiters(null, 'Liquide Vaisselle Citron 10L')).toBe(10);
      expect(parseSizeToLiters('Piece', 'Javel 5L')).toBe(5);
      expect(parseSizeToLiters(null, 'Éponge Abrasive')).toBeNull();
    });
  });

  describe('calculateContainersNeeded', () => {
    it('calculates 1 container for 10L vaisselle in a 10L bidon (user scenario)', () => {
      const result = calculateContainersNeeded(10, 1, null, 10, 'Liquide Vaisselle');
      expect(result).toBe(1);
    });

    it('calculates 2 containers for 20L vaisselle in 10L bidons', () => {
      const result = calculateContainersNeeded(20, 1, null, 10, 'Liquide Vaisselle');
      expect(result).toBe(2);
    });

    it('calculates 1 container for qty between 10 and 20 (e.g. 15L in 10L bidons requires 1 bidon, not 2)', () => {
      const result = calculateContainersNeeded(15, 1, null, 10, 'Liquide Vaisselle');
      expect(result).toBe(1);
    });

    it('handles volume less than container capacity (5L in 10L bidon requires 0 bidons)', () => {
      const result = calculateContainersNeeded(5, 1, null, 10, 'Liquide Vaisselle');
      expect(result).toBe(0);
    });

    it('correctly handles pre-packaged sized products (e.g. 2 x 5L bottles with 5L bidon)', () => {
      const result = calculateContainersNeeded(2, 1, '5L', 5, 'Liquide Vaisselle 5L');
      expect(result).toBe(2);
    });

    it('correctly handles pre-packaged 10L bottle (1 x 10L bottle with 10L bidon)', () => {
      const result = calculateContainersNeeded(1, 1, '10L', 10, 'Liquide Vaisselle 10L');
      expect(result).toBe(1);
    });

    it('handles pack multipliers (1 pack of 12 x 1L bottles with 1L container)', () => {
      const result = calculateContainersNeeded(1, 12, '1L', 1, 'Sol Lavande 1L');
      expect(result).toBe(12);
    });

    it('returns 1 container per unit when container has no capacity limit', () => {
      const result = calculateContainersNeeded(4, 1, 'Piece', null, 'Caisse Resale');
      expect(result).toBe(4);
    });

    it('returns 0 when quantity is 0 or negative', () => {
      expect(calculateContainersNeeded(0, 1, '10L', 10)).toBe(0);
      expect(calculateContainersNeeded(-5, 1, '10L', 10)).toBe(0);
    });
  });

  describe('recalculateCartForCustomer (POS-03)', () => {
    it('preserves manual price override when customer changes to wholesale, but updates non-overridden item', () => {
      const product2: Product = {
        id: 'prod-2',
        family_id: 'fam-1',
        category: 'Detergents',
        name: 'Floor Cleaner 1L',
        stock_quantity: 40,
        low_stock_threshold: 5,
        cost_reference: 2.000,
        retail_price: 5.000,
        wholesale_price: 3.800,
        active: 1
      };

      const cart: CartItem[] = [
        {
          cart_item_id: 'item-1',
          product_id: 'prod-1',
          name: 'Dish Soap 1L',
          unit_price: 4.000, // Manually overridden from 3.500 to 4.000
          price_overridden: true,
          quantity: 1,
          pack_multiplier: 1
        },
        {
          cart_item_id: 'item-2',
          product_id: 'prod-2',
          name: 'Floor Cleaner 1L',
          unit_price: 5.000, // Standard retail price, not overridden
          quantity: 1,
          pack_multiplier: 1
        }
      ];

      const wholesaleCustomer: Customer = {
        id: 'c-ws',
        name: 'Gros Djerba',
        type: 'WHOLESALE',
        reseller_discount_percent: 0,
        wallet_balance: 0
      };

      const updated = recalculateCartForCustomer(cart, wholesaleCustomer, [dummyProduct, product2]);

      // Overridden item 1 must preserve its manual price 4.000
      expect(updated[0].unit_price).toBe(4.000);
      expect(updated[0].price_overridden).toBe(true);

      // Non-overridden item 2 must flip to wholesale price 3.800
      expect(updated[1].unit_price).toBe(3.800);
    });
  });

  describe('getPriceSourceLabel (Batch 2 Item A3)', () => {
    it('returns "Modifié" when price_overridden is true regardless of customer type', () => {
      const item: CartItem = {
        cart_item_id: 'i-1',
        name: 'Item 1',
        unit_price: 3.000,
        quantity: 1,
        pack_multiplier: 1,
        price_overridden: true
      };
      const reseller: Customer = {
        id: 'c-res',
        name: 'Reseller',
        type: 'RESELLER',
        reseller_discount_percent: 10,
        wallet_balance: 0
      };
      expect(getPriceSourceLabel(item, reseller)).toBe('Modifié');
    });

    it('returns "-X% Revendeur" for RESELLER customer when not overridden', () => {
      const item: CartItem = {
        cart_item_id: 'i-1',
        name: 'Item 1',
        unit_price: 2.520,
        quantity: 1,
        pack_multiplier: 1
      };
      const reseller: Customer = {
        id: 'c-res',
        name: 'Reseller',
        type: 'RESELLER',
        reseller_discount_percent: 15,
        wallet_balance: 0
      };
      expect(getPriceSourceLabel(item, reseller)).toBe('-15% Revendeur');
    });

    it('returns "Gros" for WHOLESALE customer when not overridden', () => {
      const item: CartItem = {
        cart_item_id: 'i-1',
        name: 'Item 1',
        unit_price: 2.800,
        quantity: 1,
        pack_multiplier: 1
      };
      const wholesale: Customer = {
        id: 'c-ws',
        name: 'Wholesale',
        type: 'WHOLESALE',
        reseller_discount_percent: 0,
        wallet_balance: 0
      };
      expect(getPriceSourceLabel(item, wholesale)).toBe('Gros');
    });

    it('returns "Détail" for RETAIL customer or null/walk-in when not overridden', () => {
      const item: CartItem = {
        cart_item_id: 'i-1',
        name: 'Item 1',
        unit_price: 3.500,
        quantity: 1,
        pack_multiplier: 1
      };
      const retail: Customer = {
        id: 'c-ret',
        name: 'Retail',
        type: 'RETAIL',
        reseller_discount_percent: 0,
        wallet_balance: 0
      };
      expect(getPriceSourceLabel(item, null)).toBe('Détail');
      expect(getPriceSourceLabel(item, retail)).toBe('Détail');
    });
  });
});

