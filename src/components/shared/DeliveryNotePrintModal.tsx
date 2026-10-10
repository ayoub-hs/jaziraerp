import React, { useEffect, useState } from 'react';
import { X, Truck, Printer, Eye, EyeOff } from 'lucide-react';
import type { SaleSummary, DeliveryNote } from '../../types/index.js';
import { formatMoney, formatDate } from '../../utils/formatters.js';
import { calculateTaxBreakdown } from '../../utils/tax.js';
import { getShopInfo } from '../../services/shopInfo.js';
import { useBackButton } from '../../utils/backButton.js';
import { useModalScanPause } from '../../hooks/useModalScanPause.js';

interface DeliveryNotePrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  saleId: string | null;
}

export const DeliveryNotePrintModal: React.FC<DeliveryNotePrintModalProps> = ({
  isOpen,
  onClose,
  saleId
}) => {
  useModalScanPause(isOpen);

  const [sale, setSale] = useState<SaleSummary | null>(null);
  const [deliveryNote, setDeliveryNote] = useState<DeliveryNote | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPrices, setShowPrices] = useState(true);
  const shop = getShopInfo();

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  useEffect(() => {
    if (isOpen && saleId) {
      loadDeliveryNote(saleId);
    } else {
      setSale(null);
      setDeliveryNote(null);
    }
  }, [isOpen, saleId]);

  const loadDeliveryNote = async (id: string) => {
    try {
      setLoading(true);
      // Fetch full sale
      const saleRes = await fetch(`/api/sales/${id}`);
      if (!saleRes.ok) throw new Error('Failed to load sale');
      const saleData = await saleRes.json();
      setSale(saleData);

      // If delivery note already attached, use it; otherwise create or fetch via POST
      if (saleData.delivery_note) {
        setDeliveryNote(saleData.delivery_note);
      } else {
        const blRes = await fetch(`/api/sales/${id}/delivery-note`, {
          method: 'POST'
        });
        if (blRes.ok) {
          const blData = await blRes.json();
          setDeliveryNote(blData);
        }
      }
    } catch (err) {
      console.warn('Failed to load delivery note:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto print:p-0 print:bg-white print:static print:overflow-visible">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden flex flex-col border border-slate-200 max-h-[90vh] print:border-none print:shadow-none print:w-full print:max-w-none print:max-h-none">
        {/* Modal Toolbar */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold">Bon de Livraison (BL)</h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowPrices(!showPrices)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                showPrices
                  ? 'bg-blue-600/30 text-blue-200 border border-blue-500/40 hover:bg-blue-600/40'
                  : 'bg-amber-600/30 text-amber-200 border border-amber-500/40 hover:bg-amber-600/40'
              }`}
              title="Basculer l'affichage des prix"
            >
              {showPrices ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span>{showPrices ? 'Avec prix (TTC)' : 'Sans prix (Quantités seules)'}</span>
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Page Content */}
        <div className="p-8 overflow-y-auto flex-1 bg-slate-100 flex flex-col items-center print:p-0 print:bg-white print:overflow-visible">
          {loading || !sale ? (
            <div className="py-16 text-center text-sm text-slate-500">Chargement du bon de livraison...</div>
          ) : (
            <div className="bg-white p-8 shadow-md border border-slate-300 w-full max-w-2xl text-slate-800 text-xs flex flex-col justify-between min-h-[700px] print:w-full print:max-w-none print:shadow-none print:border-none print:p-0">
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
                    <div className="text-[11px] text-slate-600 mt-2 space-y-0.5">
                      {shop.shop_address ? <div>{shop.shop_address}</div> : null}
                      {shop.shop_phone ? <div>Tél: {shop.shop_phone}</div> : null}
                      {shop.tax_id ? (
                        <div>Matricule Fiscal: <span className="font-semibold">{shop.tax_id}</span></div>
                      ) : null}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="inline-block bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-sm mb-2">
                      BON DE LIVRAISON
                    </div>
                    <div className="text-[11px] text-slate-700 font-mono space-y-0.5">
                      <div>N° BL: <span className="font-bold text-slate-900">{deliveryNote?.number || 'En cours...'}</span></div>
                      <div>Date: {formatDate(sale.date)}</div>
                      <div className="text-[10px] text-slate-500">Réf. Vente: {sale.receipt_number}</div>
                    </div>
                  </div>
                </div>

                {/* Recipient Box */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Destinataire / Livré à :
                  </span>
                  <div className="font-bold text-sm text-slate-900">
                    {sale.customer_name || 'Client Passager'}
                  </div>
                  {(sale as any).customer_address && (
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      Adresse: {(sale as any).customer_address}
                    </div>
                  )}
                  {(sale as any).customer_phone && (
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      Tél: {(sale as any).customer_phone}
                    </div>
                  )}
                  <div className="text-[10px] text-slate-400 italic mt-1">
                    Livraison magasin / site client
                  </div>
                </div>

                {/* Items Table */}
                <table className="w-full text-left border-collapse mb-6">
                  <thead>
                    <tr className="border-b-2 border-slate-300 text-slate-600 text-[11px] uppercase">
                      <th className="py-2 px-2">Désignation</th>
                      <th className="py-2 px-2 text-center">Cond.</th>
                      <th className="py-2 px-2 text-center">Quantité</th>
                      {showPrices && (
                        <>
                          <th className="py-2 px-2 text-right">P.U. HT</th>
                          <th className="py-2 px-2 text-center">TVA</th>
                          <th className="py-2 px-2 text-right">Total HT</th>
                          <th className="py-2 px-2 text-right">Total TTC</th>
                        </>
                      )}
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
                        <tr key={item.id} className="text-[11px]">
                          <td className="py-2 px-2 font-medium text-slate-900">
                            {name}
                          </td>
                          <td className="py-2 px-2 text-center text-slate-500">
                            {item.pack_multiplier > 1 ? `Pack ×${item.pack_multiplier}` : 'Unité'}
                          </td>
                          <td className="py-2 px-2 text-center font-mono font-bold text-slate-900">
                            {item.quantity}
                          </td>
                          {showPrices && (
                            <>
                              <td className="py-2 px-2 text-right font-mono">{formatMoney(unitHT)}</td>
                              <td className="py-2 px-2 text-center">19%</td>
                              <td className="py-2 px-2 text-right font-mono">{formatMoney(lineHT)}</td>
                              <td className="py-2 px-2 text-right font-mono font-bold text-slate-900">
                                {formatMoney(lineTTC)}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Bottom Totals & Signature */}
              <div className="pt-4 border-t border-slate-200">
                {showPrices && (
                  <div className="flex justify-end mb-6">
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
                        <span>TOTAL TTC:</span>
                        <span className="font-mono text-base text-emerald-700">
                          {formatMoney(sale.total_ttc)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Two Signature Boxes (Carrier / Receiver) */}
                <div className="grid grid-cols-2 gap-6 pt-2">
                  <div className="border border-dashed border-slate-300 rounded-xl p-4 text-center h-32 flex flex-col justify-between bg-slate-50/50">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                      Signature et cachet du transporteur / livreur
                    </span>
                    <span className="text-[9px] text-slate-400 italic">Marchandise prise en charge</span>
                  </div>

                  <div className="border border-dashed border-slate-300 rounded-xl p-4 text-center h-32 flex flex-col justify-between bg-slate-50/50">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                      Signature et cachet du client / réceptionnaire
                    </span>
                    <span className="text-[9px] text-slate-400 italic">Reçu conforme en quantité et qualité</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="p-4 bg-white border-t border-slate-200 flex justify-between items-center print:hidden">
          <div className="text-xs text-slate-500">
            Mode actif: <span className="font-semibold text-slate-800">{showPrices ? 'Avec prix et totaux TTC' : 'Quantités seules (sans prix)'}</span>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
            >
              Fermer
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow transition-colors flex items-center gap-2"
            >
              <Printer className="w-4 h-4" />
              Imprimer Bon de Livraison
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
