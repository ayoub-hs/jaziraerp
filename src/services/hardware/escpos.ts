import type { SaleSummary } from '../../types/index.js';
import { formatMoney, formatDateTime } from '../../utils/formatters.js';

export const ESC = 0x1b;
export const GS = 0x1d;

/**
 * Standard Cash Drawer kick pulse command (ESC p m t1 t2)
 * Sends a 50ms pulse to pin 2 or pin 5 (standard RJ11 / RJ12 cash drawer)
 */
export function buildDrawerKickCommand(pin: 0 | 1 = 0): Uint8Array {
  // ESC p <pin: 0 or 1> <on_time: 25 * 2ms = 50ms> <off_time: 250 * 2ms = 500ms>
  return new Uint8Array([ESC, 0x70, pin, 0x19, 0xfa]);
}

/**
 * Basic ESC/POS command builder for 58mm thermal receipt paper (approx. 32 chars/line)
 */
export class EscPosBuilder {
  private buffer: number[] = [];

  constructor() {
    this.init();
  }

  public init(): this {
    this.buffer.push(ESC, 0x40); // ESC @ (Initialize printer)
    return this;
  }

  public alignLeft(): this {
    this.buffer.push(ESC, 0x61, 0); // ESC a 0
    return this;
  }

  public alignCenter(): this {
    this.buffer.push(ESC, 0x61, 1); // ESC a 1
    return this;
  }

  public alignRight(): this {
    this.buffer.push(ESC, 0x61, 2); // ESC a 2
    return this;
  }

  public bold(enable: boolean): this {
    this.buffer.push(ESC, 0x45, enable ? 1 : 0); // ESC E n
    return this;
  }

  public doubleHeight(enable: boolean): this {
    this.buffer.push(GS, 0x21, enable ? 0x10 : 0x00);
    return this;
  }

  public text(str: string): this {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    for (let i = 0; i < bytes.length; i++) {
      this.buffer.push(bytes[i]);
    }
    return this;
  }

  public line(str: string = ''): this {
    this.text(str);
    this.buffer.push(0x0a); // LF
    return this;
  }

  public divider(char: string = '-'): this {
    return this.line(char.repeat(32));
  }

  /**
   * Formats a 2-column row justified to 32 characters
   * e.g. "Total TTC:             15.500 DT"
   */
  public twoColumns(left: string, right: string, maxLen: number = 32): this {
    const spaceNeeded = maxLen - left.length - right.length;
    if (spaceNeeded > 0) {
      this.line(left + ' '.repeat(spaceNeeded) + right);
    } else {
      this.line(left.slice(0, maxLen - right.length - 1) + ' ' + right);
    }
    return this;
  }

  public feed(lines: number = 3): this {
    for (let i = 0; i < lines; i++) {
      this.buffer.push(0x0a);
    }
    return this;
  }

  public cut(partial: boolean = false): this {
    this.buffer.push(GS, 0x56, partial ? 1 : 0); // GS V n
    return this;
  }

  public kickDrawer(): this {
    const kick = buildDrawerKickCommand();
    for (let i = 0; i < kick.length; i++) {
      this.buffer.push(kick[i]);
    }
    return this;
  }

  public toUint8Array(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

/**
 * Builds full 58mm thermal receipt binary payload formatted for ESC/POS printers.
 */
export function buildReceiptEscPos(
  sale: SaleSummary,
  shopInfo = {
    name: 'SOCIETE AL JAZIRA',
    subtitle: 'SHSP - Detergents & Hygiene',
    address: 'Route de Gabes Km 3.5, Sfax',
    phone: '+216 74 000 000',
    taxId: 'MF: 1234567/A/M/000'
  }
): Uint8Array {
  const builder = new EscPosBuilder();

  // Shop Header
  builder
    .alignCenter()
    .bold(true)
    .doubleHeight(true)
    .line(shopInfo.name)
    .doubleHeight(false)
    .bold(false)
    .line(shopInfo.subtitle)
    .line(shopInfo.address)
    .line(shopInfo.phone)
    .line(shopInfo.taxId)
    .divider('=');

  // Receipt Info
  builder
    .alignLeft()
    .twoColumns('Ticket N:', sale.receipt_number)
    .twoColumns('Date:', formatDateTime(sale.date))
    .twoColumns('Client:', sale.customer_name || 'Passager')
    .divider('-');

  // Header row
  builder.twoColumns('Article', 'Total TTC');

  // Items
  for (const item of sale.items || []) {
    const rawName = item.description || item.name || (item as any).catalog_product_name || (item as any).quick_add_name || 'Article';
    const name = rawName.length > 32 ? rawName.slice(0, 31) : rawName;
    builder.line(name);
    const detail = `  ${item.quantity} x ${formatMoney(item.unit_price)}${item.pack_multiplier > 1 ? ` (x${item.pack_multiplier})` : ''}`;
    const total = formatMoney(item.total_line ?? item.line_total ?? (item.quantity * item.unit_price));
    builder.twoColumns(detail, total);

    const discount = Number(item.discount_amount) || 0;
    if (discount > 0) {
      builder.twoColumns('  Remise:', `-${formatMoney(discount)}`);
    }
  }

  builder.divider('-');

  // Totals
  builder
    .twoColumns('Subtotal HT:', formatMoney(sale.subtotal_ht))
    .twoColumns('TVA (19%):', formatMoney(sale.tva_amount));

  const globalDiscount = Number(sale.total_discount) || 0;
  if (globalDiscount > 0) {
    builder.twoColumns('Remise globale:', `-${formatMoney(globalDiscount)}`);
  }

  builder
    .bold(true)
    .twoColumns('TOTAL TTC:', formatMoney(sale.total_ttc))
    .bold(false)
    .divider('-');

  // Payments
  if (sale.cash_paid > 0) {
    builder.twoColumns('Especes:', formatMoney(sale.cash_paid));
  }
  if (sale.wallet_paid > 0) {
    builder.twoColumns('Portefeuille:', formatMoney(sale.wallet_paid));
  }
  if (sale.credit_amount > 0) {
    builder.bold(true).twoColumns('Credit (Bon):', formatMoney(sale.credit_amount)).bold(false);
  }
  if ((sale.change_given || 0) > 0) {
    builder.twoColumns('Rendu:', formatMoney(sale.change_given || 0));
  }

  builder.divider('=');

  // Footer Message
  builder
    .alignCenter()
    .line('Merci de votre visite!')
    .line('Bidons consignes remboursables')
    .line('*** AL JAZIRA SHSP ***')
    .feed(3)
    .cut(true);

  return builder.toUint8Array();
}
