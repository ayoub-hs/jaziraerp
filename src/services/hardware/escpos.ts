import type { SaleSummary } from '../../types/index.js';
import { formatMoney, formatDateTime, roundMoney } from '../../utils/formatters.js';
import { getShopInfo } from '../shopInfo.js';

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
  private width: number;

  constructor(width: 58 | 80 = 58) {
    this.width = width === 80 ? 48 : 32;
    this.init();
  }

  public getLineWidth(): number {
    return this.width;
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

  public divider(char: string = '-', len?: number): this {
    return this.line(char.repeat(len ?? this.width));
  }

  /**
   * Formats a 2-column row justified to line width (default 32 for 58mm, 48 for 80mm)
   * e.g. "Total TTC:             15.500 DT"
   */
  public twoColumns(left: string, right: string, maxLen?: number): this {
    const colLen = maxLen ?? this.width;
    const spaceNeeded = colLen - left.length - right.length;
    if (spaceNeeded > 0) {
      this.line(left + ' '.repeat(spaceNeeded) + right);
    } else {
      this.line(left.slice(0, Math.max(0, colLen - right.length - 1)) + ' ' + right);
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

export interface EscPosShopInfo {
  name?: string;
  subtitle?: string;
  address?: string;
  phone?: string;
  taxId?: string;
}

/**
 * Builds full 58mm thermal receipt binary payload formatted for ESC/POS printers.
 */
export function buildReceiptEscPos(
  sale: SaleSummary,
  shopInfo?: EscPosShopInfo
): Uint8Array {
  const currentShop = getShopInfo();
  const info = {
    name: shopInfo?.name !== undefined ? shopInfo.name : currentShop.shop_name,
    subtitle: shopInfo?.subtitle !== undefined ? shopInfo.subtitle : currentShop.shop_subtitle,
    address: shopInfo?.address !== undefined ? shopInfo.address : currentShop.shop_address,
    phone: shopInfo?.phone !== undefined ? shopInfo.phone : currentShop.shop_phone,
    taxId: shopInfo?.taxId !== undefined ? shopInfo.taxId : currentShop.tax_id
  };

  const builder = new EscPosBuilder();

  // Shop Header
  builder.alignCenter();
  if (info.name && info.name.trim()) {
    builder
      .bold(true)
      .doubleHeight(true)
      .line(info.name.trim())
      .doubleHeight(false)
      .bold(false);
  }
  if (info.subtitle && info.subtitle.trim()) {
    builder.line(info.subtitle.trim());
  }
  if (info.address && info.address.trim()) {
    builder.line(info.address.trim());
  }
  if (info.phone && info.phone.trim()) {
    builder.line(info.phone.trim());
  }
  if (info.taxId && info.taxId.trim()) {
    const taxLine = info.taxId.trim().startsWith('MF:') ? info.taxId.trim() : `MF: ${info.taxId.trim()}`;
    builder.line(taxLine);
  }
  builder.divider('=');

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
    const discount = Number(item.discount_amount) || 0;
    const computedFull = roundMoney((Number(item.quantity) || 0) * (Number(item.unit_price) || 0));
    const fullTotal = computedFull > 0
      ? computedFull
      : roundMoney((Number(item.total_line ?? (item as any).line_total) || 0) + discount);
    builder.twoColumns(detail, formatMoney(fullTotal));

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
    .feed(3)
    .cut(true);

  return builder.toUint8Array();
}

export interface ZReportSessionData {
  session_number: string;
  counter_name: string;
  opened_at: string;
  closed_at?: string | null;
  opening_cash: number;
  cash_sales: number;
  cash_refunds: number;
  net_sales_cash?: number;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
  closing_cash_counted?: number | null;
  counted_cash?: number | null;
  variance?: number | null;
  difference?: number | null;
  movements?: Array<{
    type: 'CASH_IN' | 'CASH_OUT';
    amount: number;
    reason: string;
    date?: string;
  }>;
  printed_at?: string;
}

/**
 * Formats a thermal Z-Report (clôture de caisse) slip for 58mm or 80mm printers.
 * Built ONLY from figures registerService already returns.
 */
export function formatZReport(
  sessionData: ZReportSessionData,
  width: 58 | 80 = 58,
  shopInfo?: EscPosShopInfo
): Uint8Array {
  const currentShop = getShopInfo();
  const info = {
    name: shopInfo?.name !== undefined ? shopInfo.name : currentShop.shop_name,
    subtitle: shopInfo?.subtitle !== undefined ? shopInfo.subtitle : currentShop.shop_subtitle,
    address: shopInfo?.address !== undefined ? shopInfo.address : currentShop.shop_address,
    phone: shopInfo?.phone !== undefined ? shopInfo.phone : currentShop.shop_phone,
    taxId: shopInfo?.taxId !== undefined ? shopInfo.taxId : currentShop.tax_id
  };

  const builder = new EscPosBuilder(width);
  const lineWidth = builder.getLineWidth();

  // Shop Header (Center)
  builder.alignCenter();
  if (info.name && info.name.trim()) {
    builder
      .bold(true)
      .doubleHeight(true)
      .line(info.name.trim())
      .doubleHeight(false)
      .bold(false);
  }
  if (info.subtitle && info.subtitle.trim()) {
    builder.line(info.subtitle.trim());
  }
  if (info.address && info.address.trim()) {
    builder.line(info.address.trim());
  }
  if (info.phone && info.phone.trim()) {
    builder.line(info.phone.trim());
  }
  if (info.taxId && info.taxId.trim()) {
    const taxLine = info.taxId.trim().startsWith('MF:') ? info.taxId.trim() : `MF: ${info.taxId.trim()}`;
    builder.line(taxLine);
  }
  builder.divider('=');

  // Title
  builder
    .bold(true)
    .line('RAPPORT Z - CLOTURE DE CAISSE')
    .bold(false)
    .divider('-');

  // Session info
  const printedTime = sessionData.printed_at || new Date().toISOString();
  builder
    .alignLeft()
    .twoColumns('Session N:', sessionData.session_number)
    .twoColumns('Caisse:', sessionData.counter_name)
    .twoColumns('Ouverture:', formatDateTime(sessionData.opened_at))
    .twoColumns('Cloture:', sessionData.closed_at ? formatDateTime(sessionData.closed_at) : 'En cours')
    .twoColumns('Imprime le:', formatDateTime(printedTime))
    .divider('-');

  // Figures section: built ONLY from figures registerService already returns
  const openingFloat = Number(sessionData.opening_cash) || 0;
  const cashSales = Number(sessionData.cash_sales) || 0;
  const cashRefunds = Number(sessionData.cash_refunds) || 0;
  const cashIn = Number(sessionData.cash_in) || 0;
  const cashOut = Number(sessionData.cash_out) || 0;
  const expectedCash = Number(sessionData.expected_cash) || 0;
  const countedCash = sessionData.closing_cash_counted !== null && sessionData.closing_cash_counted !== undefined
    ? Number(sessionData.closing_cash_counted)
    : (sessionData.counted_cash !== null && sessionData.counted_cash !== undefined ? Number(sessionData.counted_cash) : 0);
  const variance = sessionData.variance !== null && sessionData.variance !== undefined
    ? Number(sessionData.variance)
    : (sessionData.difference !== null && sessionData.difference !== undefined ? Number(sessionData.difference) : roundMoney(countedCash - expectedCash));

  builder
    .twoColumns('Fond initial:', formatMoney(openingFloat))
    .twoColumns('Ventes especes:', formatMoney(cashSales))
    .twoColumns('Remboursements esp.:', `-${formatMoney(cashRefunds)}`)
    .twoColumns('Entrees caisse (In):', `+${formatMoney(cashIn)}`)
    .twoColumns('Sorties caisse (Out):', `-${formatMoney(cashOut)}`);

  // Cash movements listing with reasons
  if (sessionData.movements && sessionData.movements.length > 0) {
    builder.divider('.');
    builder.bold(true).line('Mouvements de caisse:').bold(false);
    for (const m of sessionData.movements) {
      const prefix = m.type === 'CASH_IN' ? '[IN] ' : '[OUT] ';
      const sign = m.type === 'CASH_IN' ? '+' : '-';
      const right = `${sign}${formatMoney(m.amount)}`;
      const left = `  ${prefix}${m.reason || 'Mouvement'}`;
      if (left.length + right.length + 1 <= lineWidth) {
        builder.twoColumns(left, right);
      } else {
        builder.line(left);
        builder.twoColumns('    Montant:', right);
      }
    }
  }

  builder.divider('-');

  // Audit totals & Variance
  builder
    .twoColumns('Especes attendues:', formatMoney(expectedCash))
    .twoColumns('Especes comptees:', formatMoney(countedCash))
    .divider('-')
    .bold(true)
    .twoColumns('Ecart / Variance:', formatMoney(variance))
    .bold(false)
    .divider('=');

  // Signature box & Footer
  builder
    .alignCenter()
    .feed(1)
    .line('Signature Responsable :')
    .feed(2)
    .divider('.')
    .feed(3)
    .cut(true);

  return builder.toUint8Array();
}

