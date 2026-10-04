import { describe, it, expect } from 'vitest';
import { buildDrawerKickCommand, EscPosBuilder, buildReceiptEscPos, ESC, GS } from './escpos.js';
import type { SaleSummary } from '../../types/index.js';

describe('ESC/POS Thermal & Drawer Kick Hardware Service', () => {
  it('builds standard ESC/POS cash drawer kick pulse command', () => {
    const kick = buildDrawerKickCommand(0);
    // Should be exactly 5 bytes: [0x1b, 0x70, 0x00, 0x19, 0xfa]
    expect(kick.length).toBe(5);
    expect(kick[0]).toBe(0x1b); // ESC
    expect(kick[1]).toBe(0x70); // 'p'
    expect(kick[2]).toBe(0x00); // pin 0
    expect(kick[3]).toBe(0x19); // 25 (50ms)
    expect(kick[4]).toBe(0xfa); // 250 (500ms)
  });

  it('correctly constructs ESC/POS commands with text, alignment, and formatting', () => {
    const builder = new EscPosBuilder();
    builder.init().alignCenter().bold(true).line('TEST SHOP').kickDrawer();
    const bytes = builder.toUint8Array();

    // Contains ESC @, ESC a 1, ESC E 1, and drawer kick
    expect(bytes.length).toBeGreaterThan(10);
    expect(bytes[0]).toBe(ESC);
    expect(bytes[1]).toBe(0x40);
  });

  it('formats full 58mm receipt into 32-character justified columns', () => {
    const sampleSale: SaleSummary = {
      id: 'sale-test',
      receipt_number: 'REC-20260907-0001',
      date: '2026-09-07T12:00:00Z',
      customer_name: 'Moncef',
      subtotal_ht: 8.403,
      tva_rate: 0.19,
      tva_amount: 1.597,
      total_ttc: 10.000,
      cash_paid: 10.000,
      wallet_paid: 0,
      credit_amount: 0,
      status: 'COMPLETED',
      items: [
        {
          id: 'si-1',
          description: 'Dish Soap Lemon 1L',
          quantity: 2,
          unit_price: 5.000,
          pack_multiplier: 1,
          total_line: 10.000
        }
      ]
    };

    const receiptBytes = buildReceiptEscPos(sampleSale);
    expect(receiptBytes.length).toBeGreaterThan(50);

    const decoder = new TextDecoder();
    const textOutput = decoder.decode(receiptBytes);

    expect(textOutput).toContain('Société Al Jazira SHSP');
    expect(textOutput).toContain('REC-20260907-0001');
    expect(textOutput).toContain('Dish Soap Lemon 1L');
    expect(textOutput).toContain('TOTAL TTC:');
    expect(textOutput).toContain('10.000 DT');
  });

  it('correctly handles line discounts, global discounts, change given, and item name fallbacks without error', () => {
    const discountedSale: any = {
      id: 'sale-discount-test',
      receipt_number: 'REC-20260909-0042',
      date: '2026-09-09T14:00:00Z',
      customer_name: 'Khaled',
      subtotal_ht: 14.286,
      tva_rate: 0.19,
      tva_amount: 2.714,
      total_discount: 3.000,
      total_ttc: 17.000,
      cash_paid: 20.000,
      change_given: 3.000,
      wallet_paid: 0,
      credit_amount: 0,
      status: 'COMPLETED',
      items: [
        {
          id: 'si-1',
          // No description field - catalog_product_name instead (as returned by SQLite)
          catalog_product_name: 'Savon Liquide 5L',
          quantity: 2,
          unit_price: 10.000,
          pack_multiplier: 1,
          discount_amount: 1.000,
          line_total: 19.000
        },
        {
          id: 'si-2',
          // Quick add item name fallback
          quick_add_name: 'Sac Plastique 50L',
          quantity: 1,
          unit_price: 1.000,
          line_total: 1.000
        }
      ]
    };

    const receiptBytes = buildReceiptEscPos(discountedSale);
    expect(receiptBytes.length).toBeGreaterThan(50);

    const decoder = new TextDecoder();
    const textOutput = decoder.decode(receiptBytes);

    expect(textOutput).toContain('Savon Liquide 5L');
    expect(textOutput).toContain('Sac Plastique 50L');
    expect(textOutput).toContain('Remise:');
    expect(textOutput).toContain('-1.000 DT');
    expect(textOutput).toContain('Remise globale:');
    expect(textOutput).toContain('-3.000 DT');
    expect(textOutput).toContain('TOTAL TTC:');
    expect(textOutput).toContain('17.000 DT');
    expect(textOutput).toContain('Rendu:');
    expect(textOutput).toContain('3.000 DT');
  });
});
