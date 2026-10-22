import React, { useEffect, useRef, useState } from 'react';
import { X, FileText, Printer, AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import type { SaleSummary } from '../../types/index.js';
import { formatMoney, formatDate } from '../../utils/formatters.js';
import { calculateTaxBreakdown } from '../../utils/tax.js';
import { calculateCartTotals } from '../../utils/cart.js';
import { getShopInfo } from '../../services/shopInfo.js';
import { useBackButton } from '../../utils/backButton.js';
import { useModalScanPause } from '../../hooks/useModalScanPause.js';
import { clientDb } from '../../db/clientDb.js';

interface InvoicePrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  saleId: string | null;
}

export const InvoicePrintModal: React.FC<InvoicePrintModalProps> = ({
  isOpen,
  onClose,
  saleId
}) => {
  useModalScanPause(isOpen);

  const [sale, setSale] = useState<SaleSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOfflineDraft, setIsOfflineDraft] = useState(false);
  const shop = getShopInfo();

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  useEffect(() => {
    if (isOpen && saleId) {
      fetchSale(saleId);
    } else {
      setSale(null);
      setError(null);
      setIsOfflineDraft(false);
    }
  }, [isOpen, saleId]);

  const fetchSale = async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      setIsOfflineDraft(false);

      if (id.startsWith('temp_')) {
        let pending = null;
        try {
          pending = await clientDb.pending_sync_queue.where('temp_client_id').equals(id).first();
        } catch {
          pending = null;
        }

        if (pending && pending.payload) {
          const p = pending.payload;
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
              // keep fallback values
            }
          }

          setSale({
            id: p.temp_client_id || id,
            receipt_number: 'REC-OFFLINE-' + id.slice(5, 13).toUpperCase(),
            invoice_number: 'FAC-OFFLINE-' + id.slice(5, 13).toUpperCase(),
            date: p.date || pending.created_at || new Date().toISOString(),
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
          setIsOfflineDraft(true);
          return;
        } else {
          setSale(null);
          setError("Vente hors-ligne non synchronisée. La facture officielle sera disponible après synchronisation avec le serveur.");
          return;
        }
      }

      const res = await fetch(`/api/sales/${id}`);
      if (!res.ok) {
        setSale(null);
        if (res.status === 404) {
          setError('Facture introuvable.');
        } else {
          setError(`Erreur serveur lors du chargement de la facture (code ${res.status}).`);
        }
        return;
      }

      const data = await res.json();
      setSale(data);
    } catch (err: any) {
      console.warn('Failed to load invoice sale:', err);
      setSale(null);
      setError('Serveur inaccessible ou appareil hors-ligne. Impossible de charger la facture.');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto print:p-0 print:bg-white print:static print:overflow-visible">
      <div className="my-auto bg-white rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden flex flex-col border border-slate-200 max-h-[calc(100dvh-1rem)] print:border-none print:shadow-none print:w-full print:max-w-none print:max-h-none print:overflow-visible print:h-auto">
        {/* Modal Toolbar */}
        <div className="shrink-0 bg-slate-900 text-white px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-400" />
            <h2 className="text-base font-bold">Aperçu de la Facture A4</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Invoice Page (A4 Aspect) */}
        <div className="flex-1 min-h-0 p-4 sm:p-8 overflow-y-auto bg-slate-100 flex flex-col items-center print:p-0 print:bg-white print:overflow-visible">
          {!shop.tax_id && !loading && !error && (
            <div className="w-full max-w-2xl print:hidden mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold flex items-center gap-2 shadow-sm">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>Matricule fiscal non renseigné — voir Paramètres</span>
            </div>
          )}

          {error && (
            <div className="w-full max-w-2xl mb-4 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl flex items-center justify-between gap-3 text-xs print:hidden shadow-sm">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span>{error}</span>
              </div>
              {!saleId?.startsWith('temp_') && (
                <button
                  type="button"
                  onClick={() => saleId && fetchSale(saleId)}
                  className="px-3 py-1 bg-amber-200 hover:bg-amber-300 text-amber-900 font-bold rounded-lg transition-colors flex items-center gap-1 shrink-0"
                >
                  <RefreshCw className="w-3 h-3" />
                  Réessayer
                </button>
              )}
            </div>
          )}

          {isOfflineDraft && (
            <div className="w-full max-w-2xl mb-4 bg-blue-50 border border-blue-200 text-blue-900 px-4 py-3 rounded-xl flex items-center gap-2 text-xs print:hidden shadow-sm">
              <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <span>Vente hors-ligne en attente de synchronisation. Facture provisoire : le numéro officiel sera attribué après synchronisation.</span>
            </div>
          )}

          {loading ? (
            <div className="py-16 text-center text-sm text-slate-500">Chargement de la facture...</div>
          ) : !sale ? (
            <div className="py-16 text-center text-sm text-slate-600 italic">
              Aucun détail de facture disponible.
            </div>
          ) : (
            <div className="bg-white p-4 sm:p-8 shadow-md border border-slate-300 w-full max-w-2xl text-slate-800 text-xs flex flex-col justify-between min-h-[700px] print:w-full print:max-w-none print:shadow-none print:border-none print:p-0">
              <div>
                {/* Header */}
                <div className="flex justify-between items-start border-b border-slate-200 pb-6 mb-6">
                  <div>
                    <h1 className="text-xl font-black text-slate-900 tracking-tight uppercase">
                      {shop.shop_name}
                    </h1>
                    {shop.shop_subtitle ? (
                      <p className="text-slate-500 text-xs mt-0.5">{shop.shop_subtitle}</p>
                    ) : null}
                    <div className="text-xs text-slate-600 mt-2 space-y-0.5">
                      {shop.shop_address ? <div>{shop.shop_address}</div> : null}
                      {shop.shop_phone ? <div>Tél: {shop.shop_phone}</div> : null}
                      {shop.tax_id ? (
                        <div>Matricule Fiscal: <span className="font-semibold">{shop.tax_id}</span></div>
                      ) : null}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="inline-block bg-slate-900 text-white font-bold px-3 py-1.5 rounded-lg text-sm mb-2">
                      FACTURE
                    </div>
                    <div className="text-xs text-slate-700 font-mono space-y-0.5">
                      <div>Réf: <span className="font-bold">{sale.invoice_number || sale.receipt_number}</span></div>
                      <div>Date: {formatDate(sale.date)}</div>
                    </div>
                  </div>
                </div>

                {/* Client Box */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6">
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-wider block mb-1">
                    Facturé à:
                  </span>
                  <div className="font-bold text-sm text-slate-900">
                    {sale.customer_name || 'Client Passager'}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    Client au comptant / Grossiste
                  </div>
                </div>

                {/* Items Table */}
                <table className="w-full text-left border-collapse mb-6">
                  <thead>
                    <tr className="border-b-2 border-slate-300 text-slate-600 text-xs uppercase">
                      <th className="py-2 px-2">Désignation</th>
                      <th className="py-2 px-2 text-center">Qté</th>
                      <th className="py-2 px-2 text-right">P.U. HT</th>
                      <th className="py-2 px-2 text-center">TVA</th>
                      <th className="py-2 px-2 text-right">Total HT</th>
                      <th className="py-2 px-2 text-right">Total TTC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {sale.items?.map(item => {
                      const name = item.description || item.name || (item as any).catalog_product_name || (item as any).quick_add_name || 'Article';
                      const lineTTC = item.total_line ?? (item as any).line_total ?? (item.quantity * item.unit_price);
                      const tax = calculateTaxBreakdown(lineTTC, 0.19);
                      const lineHT = tax.subtotalHT;
                      const unitHT = Math.round((lineHT / (item.quantity || 1)) * 1000) / 1000;
                      return (
                        <tr key={item.id} className="text-xs">
                          <td className="py-2 px-2 font-medium text-slate-900">
                            {name}
                            {item.pack_multiplier > 1 && (
                              <span className="text-xs text-slate-500 ml-1">
                                (Pack de {item.pack_multiplier})
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-center font-mono">{item.quantity}</td>
                          <td className="py-2 px-2 text-right font-mono">{formatMoney(unitHT)}</td>
                          <td className="py-2 px-2 text-center">19%</td>
                          <td className="py-2 px-2 text-right font-mono">{formatMoney(lineHT)}</td>
                          <td className="py-2 px-2 text-right font-mono font-bold text-slate-900">
                            {formatMoney(lineTTC)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Bottom Totals & Signature */}
              <div className="pt-4 border-t border-slate-200">
                <div className="flex justify-between items-start gap-8">
                  {/* Signature Box */}
                  <div className="w-1/2 border border-dashed border-slate-300 rounded-xl p-4 text-center h-28 flex flex-col justify-between">
                    <span className="text-xs font-bold text-slate-600 uppercase">
                      Cachet & Signature Société
                    </span>
                    <span className="text-xs text-slate-600 italic">Merci de votre confiance</span>
                  </div>

                  {/* Summary Numbers */}
                  <div className="w-1/2 space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Total Brut HT:</span>
                      <span className="font-mono">{formatMoney(sale.subtotal_ht)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>TVA (19%):</span>
                      <span className="font-mono">{formatMoney(sale.tva_amount)}</span>
                    </div>
                    {(sale.total_discount || 0) > 0 && (
                      <div className="flex justify-between text-emerald-700 font-medium">
                        <span>Remise globale:</span>
                        <span className="font-mono">-{formatMoney(sale.total_discount || 0)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-black text-slate-900 pt-2 border-t-2 border-slate-800">
                      <span>NET À PAYER TTC:</span>
                      <span className="font-mono text-base text-blue-700">
                        {formatMoney(sale.total_ttc)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="shrink-0 p-3 sm:p-4 bg-white border-t border-slate-200 flex justify-end gap-3 print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs sm:text-sm transition-colors"
          >
            Fermer
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!sale || loading || Boolean(error)}
            className="min-h-[44px] py-2.5 px-5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600 text-white font-bold rounded-xl text-xs sm:text-sm shadow transition-colors flex items-center gap-2"
          >
            <Printer className="w-4 h-4" />
            Imprimer Facture A4
          </button>
        </div>
      </div>
    </div>
  );
};
