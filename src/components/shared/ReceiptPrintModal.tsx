import React, { useEffect, useRef, useState } from 'react';
import { X, Printer } from 'lucide-react';
import type { SaleSummary } from '../../types/index.js';
import { formatMoney, formatDateTime, roundMoney } from '../../utils/formatters.js';
import { calculateCartTotals } from '../../utils/cart.js';
import { webUsbPrinter } from '../../services/hardware/webusb.js';
import { webBluetoothPrinter } from '../../services/hardware/webbluetooth.js';
import { nativeSppPrinter } from '../../services/hardware/nativeSpp.js';
import { clientDb } from '../../db/clientDb.js';
import { getShopInfo } from '../../services/shopInfo.js';
import { useBackButton } from '../../utils/backButton.js';
import { useModalScanPause } from '../../hooks/useModalScanPause.js';

interface ReceiptPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  saleId: string | null;
}

export const ReceiptPrintModal: React.FC<ReceiptPrintModalProps> = ({
  isOpen,
  onClose,
  saleId
}) => {
  useModalScanPause(isOpen);

  const [sale, setSale] = useState<SaleSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const shop = getShopInfo();

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  useEffect(() => {
    if (isOpen && saleId) {
      fetchSaleDetails(saleId);
    } else {
      setSale(null);
    }
  }, [isOpen, saleId]);

  const fetchSaleDetails = async (id: string) => {
    try {
      setLoading(true);
      if (id.startsWith('temp_')) {
        const pending = await clientDb.pending_sync_queue.where('temp_client_id').equals(id).first();
        if (pending && pending.payload) {
          const p = pending.payload;
          // New payloads carry totals (DesktopPos/MobileRegister include them).
          // Fallback: recompute from queued items for payloads queued before
          // totals were included, so the reprint never shows 0.000 DT.
          let subtotalHT = Number(p.subtotal_ht) || 0;
          let tvaAmount = Number(p.tva_amount) || 0;
          let totalTTC = Number(p.total_ttc) || 0;
          if ((!totalTTC || !subtotalHT) && Array.isArray(p.items) && p.items.length > 0) {
            try {
              const recomputed = calculateCartTotals(
                p.items.map((it: any) => ({
                  quantity: Number(it.quantity) || 0,
                  unit_price: Number(it.unit_price) || 0,
                  pack_multiplier: Number(it.pack_multiplier) || 1,
                  discount_amount: Number(it.discount_amount) || 0
                })) as any,
                Number(p.total_discount) || 0
              );
              subtotalHT = recomputed.subtotalHT;
              tvaAmount = recomputed.tvaAmount;
              totalTTC = recomputed.totalTTC;
            } catch {
              // keep payload values on recompute failure
            }
          }
          setSale({
            id: p.temp_client_id || id,
            receipt_number: 'REC-OFFLINE-' + id.slice(5, 13).toUpperCase(),
            date: p.date || pending.created_at,
            customer_name: p.customer_name || 'Passager',
            subtotal_ht: subtotalHT,
            tva_rate: 0.19,
            tva_amount: tvaAmount,
            total_ttc: totalTTC,
            total_discount: p.total_discount || 0,
            cash_paid: p.cash_paid || 0,
            wallet_paid: p.wallet_paid || 0,
            credit_amount: p.credit_amount || 0,
            change_given: p.change_given || 0,
            status: 'COMPLETED',
            items: (p.items || []).map((it: any, idx: number) => ({
              id: `item_${idx}`,
              description: it.description || it.quick_add_name || it.name || 'Article',
              name: it.description || it.quick_add_name || it.name || 'Article',
              quantity: it.quantity,
              unit_price: it.unit_price,
              pack_multiplier: it.pack_multiplier || 1,
              total_line: it.line_total ?? ((it.quantity * it.unit_price) - (it.discount_amount || 0)),
              line_total: it.line_total ?? ((it.quantity * it.unit_price) - (it.discount_amount || 0)),
              discount_amount: it.discount_amount || 0
            }))
          });
          return;
        }
      }

      const res = await fetch(`/api/sales/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSale(data);
      }
    } catch (err) {
      console.warn('Failed to load sale details:', err);
    } finally {
      setLoading(false);
    }
  };

  const [printFeedback, setPrintFeedback] = useState<string | null>(null);

  const handlePrint = async () => {
    if (sale) {
      // 1. Check direct WebUSB if connected in browser
      if (webUsbPrinter.getStatus().isConnected) {
        await webUsbPrinter.printReceipt(sale);
        setPrintFeedback('Imprimé via WebUSB !');
        setTimeout(() => setPrintFeedback(null), 2500);
        return;
      }

      // 2. Check native Bluetooth Classic (SPP) bonded printer (MPT-II)
      if (nativeSppPrinter.getStatus().isConnected) {
        await nativeSppPrinter.printReceipt(sale);
        setPrintFeedback('Imprimé via Bluetooth SPP !');
        setTimeout(() => setPrintFeedback(null), 2500);
        return;
      }

      // 3. Check WebBluetooth if connected (Android)
      if (webBluetoothPrinter.getStatus().isConnected) {
        await webBluetoothPrinter.printReceipt(sale);
        setPrintFeedback('Imprimé via Bluetooth !');
        setTimeout(() => setPrintFeedback(null), 2500);
        return;
      }

      // 4. Attempt direct POS hardware driver (matches Kotlin DesktopReceiptPrinter libusb driver)
      try {
        const res = await fetch('/api/hardware/printer/print', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sale_id: sale.id, sale })
        });
        if (res.ok) {
          const data = await res.json();
          setPrintFeedback('Imprimé via H313 POS !');
          setTimeout(() => setPrintFeedback(null), 2500);
          return;
        }
      } catch (err) {
        console.warn('Backend printer call failed, falling back to browser print:', err);
      }
    }

    // 5. Fallback to standard browser print (with our clean 58mm CSS isolation)
    window.print();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto print:p-0 print:bg-white print:static print:overflow-visible">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden flex flex-col border border-slate-200 print:border-none print:shadow-none print:w-auto print:max-w-none">
        {/* Header */}
        <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <Printer className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-bold">58mm Thermal Receipt</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Receipt Container */}
        <div className="p-4 bg-slate-100 flex justify-center print:p-0 print:bg-white print:m-0">
          {loading || !sale ? (
            <div className="py-12 text-center text-xs text-slate-500">Loading receipt data...</div>
          ) : (
            <div
              ref={printRef}
              className="printable-receipt bg-white p-4 shadow-sm border border-slate-300 w-[240px] text-[11px] font-mono leading-tight text-black print:w-[58mm] print:max-w-[58mm] print:shadow-none print:border-none print:m-0 print:p-1"
              style={{ fontFamily: 'Courier, monospace' }}
            >
              {/* Shop Header */}
              <div className="text-center pb-2 border-b border-dashed border-black">
                {shop.shop_name ? <div className="font-bold text-sm uppercase">{shop.shop_name}</div> : null}
                {shop.shop_subtitle ? <div className="text-[10px]">{shop.shop_subtitle}</div> : null}
                {shop.shop_address ? <div className="text-[10px]">{shop.shop_address}</div> : null}
                {shop.shop_phone ? <div className="text-[10px]">Tél: {shop.shop_phone}</div> : null}
                {shop.tax_id ? <div className="text-[9px] text-slate-600">MF: {shop.tax_id}</div> : null}
              </div>

              {/* Receipt Metadata */}
              <div className="py-2 border-b border-dashed border-black text-[10px] space-y-0.5">
                <div className="flex justify-between">
                  <span>Ticket:</span>
                  <span className="font-bold">{sale.receipt_number}</span>
                </div>
                <div className="flex justify-between">
                  <span>Date:</span>
                  <span>{formatDateTime(sale.date)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Client:</span>
                  <span>{sale.customer_name || 'Passager'}</span>
                </div>
              </div>

              {/* Line Items */}
              <div className="py-2 border-b border-dashed border-black space-y-1">
                <div className="flex justify-between font-bold text-[10px]">
                  <span>Article</span>
                  <span>Total</span>
                </div>
                {sale.items?.map(item => {
                  const name = item.description || item.name || (item as any).catalog_product_name || (item as any).quick_add_name || 'Article';
                  const discount = Number(item.discount_amount) || 0;
                  const computedFull = roundMoney((Number(item.quantity) || 0) * (Number(item.unit_price) || 0));
                  const fullTotal = computedFull > 0
                    ? computedFull
                    : roundMoney((Number(item.total_line ?? (item as any).line_total) || 0) + discount);
                  return (
                    <div key={item.id} className="text-[10px]">
                      <div className="truncate font-semibold">{name}</div>
                      <div className="flex justify-between text-slate-600 text-[9px]">
                        <span>
                          {item.quantity} x {formatMoney(item.unit_price)}
                          {item.pack_multiplier > 1 ? ` (x${item.pack_multiplier})` : ''}
                        </span>
                        <span className="text-black font-semibold">{formatMoney(fullTotal)}</span>
                      </div>
                      {discount > 0 && (
                        <div className="flex justify-between text-slate-700 print:text-black text-[9px] italic">
                          <span className="pl-2">Remise:</span>
                          <span className="font-semibold text-rose-700 print:text-black">-{formatMoney(discount)}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Totals */}
              <div className="py-2 border-b border-dashed border-black space-y-0.5 text-[10px]">
                <div className="flex justify-between">
                  <span>Total HT:</span>
                  <span>{formatMoney(sale.subtotal_ht)}</span>
                </div>
                <div className="flex justify-between">
                  <span>TVA (19%):</span>
                  <span>{formatMoney(sale.tva_amount)}</span>
                </div>
                {(sale.total_discount || 0) > 0 && (
                  <div className="flex justify-between text-emerald-800 font-medium">
                    <span>Remise globale:</span>
                    <span>-{formatMoney(sale.total_discount || 0)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-xs pt-1">
                  <span>TOTAL TTC:</span>
                  <span>{formatMoney(sale.total_ttc)}</span>
                </div>
              </div>

              {/* Payments */}
              <div className="py-2 border-b border-dashed border-black space-y-0.5 text-[10px]">
                {sale.cash_paid > 0 && (
                  <div className="flex justify-between">
                    <span>Espèces:</span>
                    <span>{formatMoney(sale.cash_paid)}</span>
                  </div>
                )}
                {sale.wallet_paid > 0 && (
                  <div className="flex justify-between">
                    <span>Solde Portefeuille:</span>
                    <span>{formatMoney(sale.wallet_paid)}</span>
                  </div>
                )}
                {sale.credit_amount > 0 && (
                  <div className="flex justify-between text-amber-900 font-bold">
                    <span>Bon de Crédit:</span>
                    <span>{formatMoney(sale.credit_amount)}</span>
                  </div>
                )}
                {(sale.change_given || 0) > 0 && (sale.cash_paid || 0) > 0 && (
                  <div className="flex justify-between">
                    <span>Espèces reçues:</span>
                    <span>{formatMoney((sale.cash_paid || 0) + (sale.change_given || 0))}</span>
                  </div>
                )}
                {(sale.change_given || 0) > 0 && (
                  <div className="flex justify-between text-emerald-700 font-bold">
                    <span>Rendu monnaie:</span>
                    <span>{formatMoney(sale.change_given || 0)}</span>
                  </div>
                )}
              </div>

              {/* Footer Notice */}
              <div className="text-center pt-3 text-[9px] space-y-0.5">
                <div>Merci de votre visite!</div>
                <div>Les bidons consignés sont remboursables</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-white border-t border-slate-200 flex flex-col gap-2 print:hidden">
          {printFeedback && (
            <div className="text-center text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 py-1.5 px-3 rounded-lg">
              ✓ {printFeedback}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
            >
              Fermer
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow transition-colors flex items-center justify-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimer (58mm)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
