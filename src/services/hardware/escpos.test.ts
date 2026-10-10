import { describe, it, expect } from 'vitest';
import { buildDrawerKickCommand, EscPosBuilder, buildReceiptEscPos, formatZReport, ESC, GS } from './escpos.js';
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
    expect(textOutput).not.toContain('*** AL JAZIRA SHSP ***');
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
    expect(textOutput).toContain('20.000 DT');
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

  it('b) escpos buildReceiptEscPos: blank address/phone/tax ID produce no lines for them; filled values appear', () => {
    const sale: any = {
      receipt_number: 'REC-TEST-B',
      date: '2026-10-04T10:00:00Z',
      customer_name: 'Client Test',
      total_ttc: 5.000,
      cash_paid: 5.000,
      items: [
        { description: 'Article 1', quantity: 1, unit_price: 5.000, line_total: 5.000 }
      ]
    };

    // 1. Blank address, phone, tax ID
    const blankBytes = buildReceiptEscPos(sale, {
      name: 'Boutique SHSP',
      subtitle: '',
      address: '',
      phone: '',
      taxId: ''
    });
    const blankText = new TextDecoder().decode(blankBytes);
    expect(blankText).toContain('Boutique SHSP');
    expect(blankText).not.toContain('Route de Gabes');
    expect(blankText).not.toContain('Tel:');
    expect(blankText).not.toContain('Tél:');
    expect(blankText).not.toContain('MF:');

    // 2. Filled values appear
    const filledBytes = buildReceiptEscPos(sale, {
      name: 'Boutique SHSP',
      subtitle: 'Produits Pro',
      address: 'Avenue Habib Bourguiba',
      phone: '+216 71 222 333',
      taxId: '1234567/Z/A/000'
    });
    const filledText = new TextDecoder().decode(filledBytes);
    expect(filledText).toContain('Boutique SHSP');
    expect(filledText).toContain('Produits Pro');
    expect(filledText).toContain('Avenue Habib Bourguiba');
    expect(filledText).toContain('+216 71 222 333');
    expect(filledText).toContain('MF: 1234567/Z/A/000');
  });

  describe('formatZReport (Batch 2 Item B1)', () => {
    const mockZSessionData: any = {
      session_number: 'SES-20261010-0042',
      counter_name: 'Caisse Principale',
      opened_at: '2026-10-10T08:00:00Z',
      closed_at: '2026-10-10T18:00:00Z',
      opening_cash: 100.000,
      cash_sales: 250.000,
      cash_refunds: 20.000,
      cash_in: 50.000,
      cash_out: 30.000,
      expected_cash: 350.000,
      closing_cash_counted: 345.000,
      variance: -5.000,
      movements: [
        { type: 'CASH_IN', amount: 50.000, reason: 'Apport monnaie' },
        { type: 'CASH_OUT', amount: 30.000, reason: 'Paiement coursier' }
      ],
      printed_at: '2026-10-10T18:01:00Z'
    };

    it('formats 58mm Z-report with all session figures matching registerService', () => {
      const bytes = formatZReport(mockZSessionData, 58, {
        name: 'Al Jazira SHSP',
        address: 'Djerba Midoun',
        phone: '75 123 456',
        taxId: '1234567/A/M/000'
      });

      const text = new TextDecoder().decode(bytes);

      // Shop header
      expect(text).toContain('Al Jazira SHSP');
      expect(text).toContain('Djerba Midoun');
      expect(text).toContain('75 123 456');

      // Title & identifiers
      expect(text).toContain('RAPPORT Z');
      expect(text).toContain('SES-20261010-0042');
      expect(text).toContain('Caisse Principale');

      // Figures matching registerService
      expect(text).toContain('100.000 DT'); // Opening float
      expect(text).toContain('250.000 DT'); // Cash sales
      expect(text).toContain('20.000 DT');  // Cash refunds
      expect(text).toContain('50.000 DT');  // Cash in
      expect(text).toContain('30.000 DT');  // Cash out
      expect(text).toContain('350.000 DT'); // Expected cash
      expect(text).toContain('345.000 DT'); // Counted cash
      expect(text).toContain('-5.000 DT');  // Variance

      // Movements with reasons
      expect(text).toContain('Apport monnaie');
      expect(text).toContain('Paiement coursier');

      // Contains cut command (GS V 1)
      expect(bytes[bytes.length - 3]).toBe(GS);
      expect(bytes[bytes.length - 2]).toBe(0x56);
      expect(bytes[bytes.length - 1]).toBe(0x01); // partial cut
    });

    it('formats 80mm Z-report with 48-char dividers', () => {
      const bytes = formatZReport(mockZSessionData, 80);
      const text = new TextDecoder().decode(bytes);

      expect(text).toContain('-'.repeat(48));
      expect(text).toContain('SES-20261010-0042');
      expect(text).toContain('350.000 DT');
      expect(text).toContain('345.000 DT');
    });
  });
});
