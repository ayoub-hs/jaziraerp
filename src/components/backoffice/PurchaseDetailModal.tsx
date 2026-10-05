import React, { useState, useEffect } from 'react';
import { X, ShoppingBag, Calendar, AlertCircle, RefreshCw, Truck, CreditCard, DollarSign } from 'lucide-react';
import { formatMoney, formatDate } from '../../utils/formatters.js';

interface PurchaseItem {
  id: string;
  item_type: 'RAW_MATERIAL' | 'RESALE_PRODUCT';
  material_id?: string | null;
  product_id?: string | null;
  item_name: string;
  item_category_or_size?: string | null;
  material_unit?: string | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
}

interface PurchaseDetail {
  id: string;
  purchase_number: string;
  supplier_id: string;
  supplier_name: string;
  date: string;
  total_amount: number;
  payment_status: 'PAID' | 'CREDIT';
  cash_paid?: number;
  debt_remaining?: number;
  debt_amount?: number;
  notes?: string | null;
  created_at: string;
  items: PurchaseItem[];
}

interface PurchaseDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  purchaseId: string | null;
}

export const PurchaseDetailModal: React.FC<PurchaseDetailModalProps> = ({
  isOpen,
  onClose,
  purchaseId
}) => {
  const [purchase, setPurchase] = useState<PurchaseDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && purchaseId) {
      loadPurchaseDetail();
    } else {
      setPurchase(null);
      setError(null);
    }
  }, [isOpen, purchaseId]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const loadPurchaseDetail = async () => {
    if (!purchaseId) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/purchases/${purchaseId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erreur lors du chargement des détails de l\'achat');
      }
      const data: PurchaseDetail = await res.json();
      setPurchase(data);
    } catch (err: any) {
      setError(err.message || 'Impossible de charger cet achat');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen || !purchaseId) return null;

  const isPaid = purchase?.payment_status === 'PAID';
  const downPayment = purchase?.cash_paid ?? (isPaid ? purchase?.total_amount ?? 0 : 0);
  const remainingDebt = purchase?.debt_remaining ?? (isPaid ? 0 : purchase?.total_amount ?? 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full flex flex-col border border-slate-200 max-h-[90vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/30 border border-emerald-400/40 flex items-center justify-center text-emerald-400">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black">Détail de l'Achat / Purchase Details</h2>
                {purchase && (
                  <span className="font-mono text-xs font-bold text-slate-300">
                    #{purchase.purchase_number}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {purchase?.supplier_name || 'Chargement fournisseur...'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadPurchaseDetail}
              disabled={isLoading}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              title="Actualiser"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              title="Fermer (Échap)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-800 text-xs font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {isLoading ? (
            <div className="py-16 text-center">
              <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-500">Chargement des détails de l'achat...</p>
            </div>
          ) : !purchase ? (
            <div className="py-16 text-center text-slate-400">
              <p className="text-sm font-semibold">Aucun détail disponible.</p>
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Date</span>
                  <div className="flex items-center gap-1 mt-0.5 text-xs font-semibold text-slate-800">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>{formatDate(purchase.date)}</span>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Statut Paiement</span>
                  <span
                    className={`inline-block mt-0.5 px-2 py-0.5 text-[11px] font-bold rounded-md ${
                      isPaid
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        : 'bg-amber-100 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {isPaid ? 'PAYÉ COMPTANT' : 'CRÉDIT / DETTE'}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Acompte Versé</span>
                  <span className="text-sm font-black font-mono text-emerald-700 mt-0.5 block">
                    {formatMoney(downPayment)}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Dette Restante</span>
                  <span
                    className={`text-sm font-black font-mono mt-0.5 block ${
                      remainingDebt > 0 ? 'text-rose-700' : 'text-slate-700'
                    }`}
                  >
                    {formatMoney(remainingDebt)}
                  </span>
                </div>
              </div>

              {/* Supplier & Notes info */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 px-1 text-xs">
                <div className="flex items-center gap-1.5 text-slate-600">
                  <Truck className="w-4 h-4 text-slate-400" />
                  <span>Fournisseur: <strong className="text-slate-900">{purchase.supplier_name}</strong></span>
                </div>
                {purchase.notes && (
                  <div className="text-slate-500 italic max-w-md truncate">
                    Note: "{purchase.notes}"
                  </div>
                )}
              </div>

              {/* Line Items Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="px-4 py-2.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Articles Achetés / Line Items ({purchase.items?.length || 0})
                  </h3>
                  <span className="text-xs font-bold text-slate-500">
                    Total: <strong className="text-slate-900 font-mono text-sm">{formatMoney(purchase.total_amount)}</strong>
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[600px]">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="py-2.5 px-3">Article / Désignation</th>
                        <th className="py-2.5 px-3">Type</th>
                        <th className="py-2.5 px-3 text-right">Quantité</th>
                        <th className="py-2.5 px-3 text-right">Coût Unitaire (DT)</th>
                        <th className="py-2.5 px-3 text-right">Total HT (DT)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {purchase.items?.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-2.5 px-3 font-semibold text-slate-900">
                            {item.item_name}
                            {item.item_category_or_size && (
                              <span className="text-[10px] text-slate-400 font-normal ml-1.5">
                                ({item.item_category_or_size})
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-100 text-slate-700">
                              {item.item_type === 'RAW_MATERIAL' ? 'Matière première' : 'Produit fini'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">
                            {item.quantity} {item.material_unit || 'u'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-700">
                            {formatMoney(item.unit_cost)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                            {formatMoney(item.total_cost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 font-bold border-t border-slate-200 text-xs">
                      <tr>
                        <td colSpan={4} className="py-2.5 px-3 text-right text-slate-700">Total Achat :</td>
                        <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900">
                          {formatMoney(purchase.total_amount)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>{purchase?.items?.length || 0} ligne(s) d'achat</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-200 shadow-2xs transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
