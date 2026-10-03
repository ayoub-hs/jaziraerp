import React, { useEffect, useRef, useState } from 'react';
import { X, FileText, Printer } from 'lucide-react';
import type { SaleSummary } from '../../types/index.js';
import { formatMoney, formatDate } from '../../utils/formatters.js';
import { calculateTaxBreakdown } from '../../utils/tax.js';

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
  const [sale, setSale] = useState<SaleSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && saleId) {
      fetchSale(saleId);
    } else {
      setSale(null);
    }
  }, [isOpen, saleId]);

  const fetchSale = async (id: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/sales/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSale(data);
      }
    } catch (err) {
      console.warn('Failed to load invoice sale:', err);
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
            <FileText className="w-5 h-5 text-blue-400" />
            <h2 className="text-base font-bold">A4 Professional Invoice Preview</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Invoice Page (A4 Aspect) */}
        <div className="p-8 overflow-y-auto flex-1 bg-slate-100 flex justify-center print:p-0 print:bg-white print:overflow-visible">
          {loading || !sale ? (
            <div className="py-16 text-center text-sm text-slate-500">Loading invoice document...</div>
          ) : (
            <div className="bg-white p-8 shadow-md border border-slate-300 w-full max-w-2xl text-slate-800 text-xs flex flex-col justify-between min-h-[700px] print:w-full print:max-w-none print:shadow-none print:border-none print:p-0">
              <div>
                {/* Header */}
                <div className="flex justify-between items-start border-b border-slate-200 pb-6 mb-6">
                  <div>
                    <h1 className="text-xl font-black text-slate-900 tracking-tight uppercase">
                      Société Al Jazira SHSP
                    </h1>
                    <p className="text-slate-500 text-xs mt-0.5">Fabrication & Vente de Détergents et Produits d'Hygiène</p>
                    <div className="text-[11px] text-slate-600 mt-2 space-y-0.5">
                      <div>Route de Gabès Km 3.5, Sfax, Tunisie</div>
                      <div>Tél: +216 74 000 000 / +216 98 000 000</div>
                      <div>Matricule Fiscal: <span className="font-semibold">1234567/A/M/000</span></div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="inline-block bg-slate-900 text-white font-bold px-3 py-1.5 rounded-lg text-sm mb-2">
                      FACTURE
                    </div>
                    <div className="text-[11px] text-slate-700 font-mono space-y-0.5">
                      <div>Réf: <span className="font-bold">{sale.invoice_number || sale.receipt_number}</span></div>
                      <div>Date: {formatDate(sale.date)}</div>
                    </div>
                  </div>
                </div>

                {/* Client Box */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Facturé à:
                  </span>
                  <div className="font-bold text-sm text-slate-900">
                    {sale.customer_name || 'Client Passager'}
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5">
                    Client au comptant / Grossiste
                  </div>
                </div>

                {/* Items Table */}
                <table className="w-full text-left border-collapse mb-6">
                  <thead>
                    <tr className="border-b-2 border-slate-300 text-slate-600 text-[11px] uppercase">
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
                        <tr key={item.id} className="text-[11px]">
                          <td className="py-2 px-2 font-medium text-slate-900">
                            {name}
                            {item.pack_multiplier > 1 && (
                              <span className="text-[10px] text-slate-500 ml-1">
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
                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                      Cachet & Signature Société
                    </span>
                    <span className="text-[9px] text-slate-400 italic">Merci de votre confiance</span>
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
                    <div className="flex justify-between text-slate-600">
                      <span>Droit de Timbre:</span>
                      <span className="font-mono">1.000 DT</span>
                    </div>
                    <div className="flex justify-between text-sm font-black text-slate-900 pt-2 border-t-2 border-slate-800">
                      <span>NET À PAYER TTC:</span>
                      <span className="font-mono text-base text-blue-700">
                        {formatMoney(sale.total_ttc + 1.000)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="p-4 bg-white border-t border-slate-200 flex justify-end gap-3 print:hidden">
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
            className="py-2.5 px-5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow transition-colors flex items-center gap-2"
          >
            <Printer className="w-4 h-4" />
            Imprimer Facture A4
          </button>
        </div>
      </div>
    </div>
  );
};
