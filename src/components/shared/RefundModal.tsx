import React, { useState, useEffect } from 'react';
import { X, RotateCcw, Search, AlertCircle, CheckCircle, ArrowRight } from 'lucide-react';
import type { SaleSummary } from '../../types/index.js';
import { formatMoney, formatDateTime } from '../../utils/formatters.js';
import { useBackButton } from '../../utils/backButton.js';
import { useModalScanPause } from '../../hooks/useModalScanPause.js';
import { useRequestKey } from '../../hooks/useRequestKey.js';

interface RefundModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefundCompleted: () => void;
  initialSaleId?: string | null;
  activeSessionId?: string | null;
}

export const RefundModal: React.FC<RefundModalProps> = ({
  isOpen,
  onClose,
  onRefundCompleted,
  initialSaleId,
  activeSessionId
}) => {
  useModalScanPause(isOpen);
  const { keyFor, clear: clearRequestKey } = useRequestKey();

  const [searchReceipt, setSearchReceipt] = useState('');
  const [recentSales, setRecentSales] = useState<SaleSummary[]>([]);
  const [selectedSale, setSelectedSale] = useState<SaleSummary | null>(null);
  const [saleRefunds, setSaleRefunds] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Refund form state
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [refundQuantity, setRefundQuantity] = useState<string>('1');
  const [reason, setReason] = useState<string>('Marchandise retournée par le client');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Split payout state
  const [splitCredit, setSplitCredit] = useState<string>('0');
  const [splitCash, setSplitCash] = useState<string>('0');
  const [splitWallet, setSplitWallet] = useState<string>('0');
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Register sessions for cash refunds
  const [openSessions, setOpenSessions] = useState<any[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [sessionTouched, setSessionTouched] = useState(false);

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  useEffect(() => {
    if (isOpen) {
      if (initialSaleId) {
        handleSelectSale({ id: initialSaleId } as any);
      } else {
        fetchRecentSales();
        setSelectedSale(null);
        setSaleRefunds([]);
      }
      setError(null);
      setSuccess(null);
      setSearchReceipt('');
      setSelectedSessionId('');
      setSessionTouched(false);
      setPreviewData(null);

      // Fetch open register sessions
      fetch('/api/register/open-sessions')
        .then(res => res.ok ? res.json() : [])
        .then((sessions: any[]) => {
          setOpenSessions(sessions || []);
        })
        .catch(() => setOpenSessions([]));
    }
  }, [isOpen, initialSaleId]);

  // Fetch refund preview and suggested allocation whenever sale, item, or quantity changes
  useEffect(() => {
    if (!selectedSale || !selectedItemId) {
      setPreviewData(null);
      return;
    }
    const qty = parseFloat(refundQuantity);
    if (isNaN(qty) || qty <= 0) {
      setPreviewData(null);
      return;
    }

    let isMounted = true;
    setPreviewLoading(true);

    fetch(`/api/sales/${selectedSale.id}/refund/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ sale_item_id: selectedItemId, quantity: qty }]
      })
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!isMounted || !data) return;
        setPreviewData(data);
        if (data.suggested_allocation) {
          setSplitCredit((data.suggested_allocation.credit_reduced ?? 0).toFixed(3));
          setSplitCash((data.suggested_allocation.cash_refunded ?? 0).toFixed(3));
          setSplitWallet((data.suggested_allocation.wallet_refunded ?? 0).toFixed(3));
        }
      })
      .catch(err => {
        console.warn('Failed to load refund preview:', err);
      })
      .finally(() => {
        if (isMounted) setPreviewLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedSale?.id, selectedItemId, refundQuantity]);

  // Default session: POS flow (no initialSaleId) uses the operating counter's
  // own open session; Ventes flow uses the original sale's session if open,
  // otherwise requires an explicit choice with no preselection.
  useEffect(() => {
    if (!isOpen || openSessions.length === 0 || sessionTouched) return;
    if (initialSaleId) {
      if (!selectedSale) return; // wait for the sale to load
      const saleSession = selectedSale.session_id;
      setSelectedSessionId(
        saleSession && openSessions.some(s => s.id === saleSession) ? saleSession : ''
      );
    } else if (activeSessionId && openSessions.some(s => s.id === activeSessionId)) {
      setSelectedSessionId(activeSessionId);
    } else if (openSessions.length === 1) {
      setSelectedSessionId(openSessions[0].id);
    } else {
      setSelectedSessionId('');
    }
  }, [isOpen, initialSaleId, openSessions, selectedSale?.session_id, activeSessionId, sessionTouched]);

  const fetchRecentSales = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/sales?limit=10');
      if (res.ok) {
        const data = await res.json();
        setRecentSales(data);
      }
    } catch (err) {
      console.warn('Failed to load recent sales:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSale = async (sale: SaleSummary) => {
    try {
      setLoading(true);
      const [res, refundsRes] = await Promise.all([
        fetch(`/api/sales/${sale.id}`),
        fetch(`/api/sales/${sale.id}/refunds`)
      ]);
      if (res.ok) {
        const fullSale = await res.json();
        setSelectedSale(fullSale);
        setError(null);
        if (fullSale.items && fullSale.items.length > 0) {
          const refundableItem = fullSale.items.find(
            (i: any) => (i.quantity || 0) - (i.quantity_refunded ?? i.refunded_quantity ?? 0) > 0
          );
          if (refundableItem) {
            setSelectedItemId(refundableItem.id);
            const remaining = (refundableItem.quantity || 0) - (refundableItem.quantity_refunded ?? refundableItem.refunded_quantity ?? 0);
            setRefundQuantity(remaining.toString());
          } else {
            setSelectedItemId(fullSale.items[0].id);
            setRefundQuantity('');
            setError('Tous les articles de cette vente ont déjà été intégralement remboursés.');
          }
        }
      }
      if (refundsRes.ok) {
        setSaleRefunds(await refundsRes.json());
      } else {
        setSaleRefunds([]);
      }
    } catch (err: any) {
      setError(err.message || 'Échec de la récupération des détails de la vente');
    } finally {
      setLoading(false);
    }
  };

  const numCredit = Math.max(0, parseFloat(splitCredit) || 0);
  const numCash = Math.max(0, parseFloat(splitCash) || 0);
  const numWallet = Math.max(0, parseFloat(splitWallet) || 0);
  const sumSplit = Math.round((numCredit + numCash + numWallet) * 1000) / 1000;
  const expectedTotal = previewData ? previewData.total_refunded : 0;
  const isTotalBalanced = Math.abs(sumSplit - expectedTotal) < 0.001;

  const maxCashCap = previewData?.capacities?.max_cash ?? 0;
  const maxDebtCap = previewData?.capacities?.open_debt ?? 0;
  const maxWalletCap = previewData?.capacities?.max_wallet ?? 0;

  const isCashOverCap = numCash > maxCashCap + 0.0001;
  const isCreditOverCap = numCredit > maxDebtCap + 0.0001;
  const isCashWithNoSession = numCash > 0 && openSessions.length === 0;
  const isMultipleSessionsUnselected = numCash > 0 && openSessions.length > 1 && !selectedSessionId;

  const currentItem = selectedSale?.items?.find(i => i.id === selectedItemId);
  const currentRemaining = currentItem ? (currentItem.quantity || 0) - (currentItem.quantity_refunded ?? currentItem.refunded_quantity ?? 0) : 0;

  const isSubmitDisabled = (
    isSubmitting ||
    previewLoading ||
    currentRemaining <= 0 ||
    !refundQuantity ||
    parseFloat(refundQuantity) <= 0 ||
    !isTotalBalanced ||
    isCashOverCap ||
    isCreditOverCap ||
    isCashWithNoSession ||
    isMultipleSessionsUnselected
  );

  const handleProcessRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSale || !selectedItemId || isSubmitDisabled) return;

    const qty = parseFloat(refundQuantity);
    if (isNaN(qty) || qty <= 0) {
      setError('La quantité à rembourser doit être supérieure à 0');
      return;
    }

    const item = selectedSale.items?.find(i => i.id === selectedItemId);
    if (!item) {
      setError('Article introuvable dans la vente');
      return;
    }

    const maxAllowed = (item.quantity || 0) - (item.quantity_refunded ?? item.refunded_quantity ?? 0);
    if (qty > maxAllowed) {
      setError(`Impossible de rembourser ${qty} unité(s). Maximum remboursable : ${maxAllowed}`);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const refundBase = {
        credit_reduced: numCredit,
        cash_refunded: numCash,
        wallet_refunded: numWallet,
        reason,
        session_id: numCash > 0 ? selectedSessionId || undefined : undefined,
        items: [
          {
            sale_item_id: selectedItemId,
            quantity: qty
          }
        ]
      };
      const clientRequestId = keyFor(JSON.stringify(refundBase));
      const res = await fetch(`/api/sales/${selectedSale.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...refundBase,
          client_request_id: clientRequestId
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Échec du remboursement');
      }

      clearRequestKey();
      setSuccess(`Remboursement validé avec succès pour ${qty} x ${item.description}`);
      onRefundCompleted();
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de l\'enregistrement du remboursement');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 m-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 overflow-y-auto">
      <div className="my-auto bg-white rounded-xl shadow-2xl max-w-xl w-full max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="shrink-0 bg-slate-900 text-white px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold">Retours & Remboursements Partiels</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-300 hover:text-white rounded-lg hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
            title="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4 text-center py-8">
              <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto" />
              <h3 className="text-lg font-bold text-slate-800">Remboursement Validé</h3>
              <p className="text-sm text-slate-600">{success}</p>
            </div>
            <div className="shrink-0 p-3 sm:p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] py-2.5 px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm transition-colors"
              >
                Fermer
              </button>
            </div>
          </div>
        ) : !selectedSale ? (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-4">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  placeholder="Filtrer les reçus récents..."
                  value={searchReceipt}
                  onChange={e => setSearchReceipt(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Sélectionner une vente récente à rembourser
                </h3>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl max-h-60 overflow-y-auto">
                  {recentSales
                    .filter(s =>
                      s.receipt_number.toLowerCase().includes(searchReceipt.toLowerCase()) ||
                      (s.customer_name && s.customer_name.toLowerCase().includes(searchReceipt.toLowerCase()))
                    )
                    .map(sale => (
                      <div
                        key={sale.id}
                        onClick={() => handleSelectSale(sale)}
                        className="p-3 hover:bg-slate-50 cursor-pointer flex items-center justify-between transition-colors"
                      >
                        <div>
                          <div className="font-bold text-sm text-slate-900 font-mono">
                            {sale.receipt_number}
                          </div>
                          <div className="text-xs text-slate-500">
                            {sale.customer_name || 'Passager'} • {formatDateTime(sale.date)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-sm text-slate-900 font-mono">
                            {formatMoney(sale.total_ttc)}
                          </div>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                            sale.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {sale.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  {recentSales.length === 0 && (
                    <div className="p-4 text-center text-xs text-slate-500">
                      Aucune vente récente trouvée
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="shrink-0 p-3 sm:p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] py-2.5 px-5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm transition-colors"
              >
                Fermer
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleProcessRefund} className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-4">
              {/* Selected Sale Overview */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex justify-between items-center text-xs">
                <div>
                  <span className="font-bold text-slate-900 font-mono">{selectedSale.receipt_number}</span>
                  <div className="text-slate-500">
                    {selectedSale.customer_name || 'Passager'} • {formatDateTime(selectedSale.date)}
                  </div>
                  {(selectedSale as any).debt_ticket && (
                    <div className="text-xs font-semibold text-amber-800 mt-0.5">
                      Dette liée : {formatMoney((selectedSale as any).debt_ticket.remaining_amount)} restants / {formatMoney((selectedSale as any).debt_ticket.total_amount)}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSale(null)}
                  className="text-emerald-700 hover:text-emerald-900 font-bold underline text-xs"
                >
                  Changer de ticket
                </button>
              </div>

              {/* Prior Refunds for this Sale */}
              {saleRefunds.length > 0 && (
                <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3 space-y-2">
                  <h4 className="text-xs font-bold text-amber-950 uppercase tracking-wider">
                    Remboursements antérieurs pour ce ticket ({saleRefunds.length})
                  </h4>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {saleRefunds.map((rf: any) => (
                      <div key={rf.id} className="text-xs bg-white p-2 rounded-lg border border-amber-100 flex justify-between items-center">
                        <div>
                          <span className="font-bold text-slate-800">
                            {formatMoney(rf.total_refunded ?? rf.refund_amount ?? 0)}
                          </span> via <span className="font-semibold text-slate-600">{rf.refund_method || ((Number(rf.credit_reduced) || 0) > 0 ? 'CREDIT_REDUCTION' : ((Number(rf.wallet_refunded) || 0) > 0 ? 'WALLET' : 'CASH'))}</span>
                          <div className="text-slate-600 text-xs">{rf.reason || 'Aucun motif spécifié'} • {formatDateTime(rf.created_at)}</div>
                        </div>
                        <span className="text-xs font-bold px-2 py-0.5 bg-amber-100 text-amber-950 rounded">
                          {rf.status || 'COMPLETED'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Choose Line Item */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Sélectionner l'article à retourner *
                </label>
                <select
                  value={selectedItemId}
                  onChange={e => {
                    setSelectedItemId(e.target.value);
                    const item = selectedSale.items?.find(i => i.id === e.target.value);
                    if (item) {
                      const remaining = (item.quantity || 0) - (item.quantity_refunded ?? item.refunded_quantity ?? 0);
                      if (remaining > 0) {
                        setRefundQuantity(remaining.toString());
                        setError(null);
                      } else {
                        setRefundQuantity('');
                        setError('Cet article a déjà été totalement remboursé.');
                      }
                    }
                  }}
                  className="w-full text-sm font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                >
                  {selectedSale.items?.map(item => {
                    const remaining = (item.quantity || 0) - (item.quantity_refunded ?? item.refunded_quantity ?? 0);
                    return (
                      <option key={item.id} value={item.id} disabled={remaining <= 0}>
                        {item.description} — {formatMoney(item.unit_price)} (Acheté : {item.quantity}, Restant : {remaining})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Quantity */}
              <div>
                <label htmlFor="refund-quantity" className="block text-xs font-bold text-slate-700 mb-1">
                  Quantité à rembourser *
                </label>
                <input
                  id="refund-quantity"
                  aria-label="Quantité à rembourser"
                  type="number"
                  step="any"
                  min="0.001"
                  value={refundQuantity}
                  onChange={e => setRefundQuantity(e.target.value)}
                  className="w-full text-sm font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              {/* Split Payout Section */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Répartition du remboursement
                  </span>
                  {previewData && (
                    <span className="text-xs font-bold font-mono text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                      Total : {formatMoney(previewData.total_refunded)}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {/* Credit Reduction */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label htmlFor="split-credit" className="text-xs font-bold text-slate-700">
                        Réduction de dette
                      </label>
                      <span className="text-xs text-slate-500 font-mono">
                        Max: {formatMoney(maxDebtCap)}
                      </span>
                    </div>
                    <input
                      id="split-credit"
                      aria-label="Réduction de dette"
                      type="number"
                      step="0.001"
                      min="0"
                      value={splitCredit}
                      onChange={e => setSplitCredit(e.target.value)}
                      className={`w-full text-xs font-bold font-mono px-2.5 py-1.5 border rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none ${
                        isCreditOverCap ? 'border-rose-400 bg-rose-50 text-rose-900' : 'border-slate-300 bg-white'
                      }`}
                    />
                  </div>

                  {/* Cash Payout */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label htmlFor="split-cash" className="text-xs font-bold text-slate-700">
                        Espèces
                      </label>
                      <span className="text-xs text-slate-500 font-mono">
                        Max: {formatMoney(maxCashCap)}
                      </span>
                    </div>
                    <input
                      id="split-cash"
                      aria-label="Espèces"
                      type="number"
                      step="0.001"
                      min="0"
                      value={splitCash}
                      onChange={e => setSplitCash(e.target.value)}
                      className={`w-full text-xs font-bold font-mono px-2.5 py-1.5 border rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none ${
                        isCashOverCap ? 'border-rose-400 bg-rose-50 text-rose-900' : 'border-slate-300 bg-white'
                      }`}
                    />
                  </div>

                  {/* Wallet Credit */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label htmlFor="split-wallet" className="text-xs font-bold text-slate-700">
                        Portefeuille (Avoir)
                      </label>
                      <span className="text-xs text-slate-500 font-mono">
                        Max: {formatMoney(maxWalletCap)}
                      </span>
                    </div>
                    <input
                      id="split-wallet"
                      aria-label="Portefeuille"
                      type="number"
                      step="0.001"
                      min="0"
                      disabled={!selectedSale?.customer_id}
                      value={splitWallet}
                      onChange={e => setSplitWallet(e.target.value)}
                      className="w-full text-xs font-bold font-mono px-2.5 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>
                </div>

                {/* Live Split Balance Warning */}
                {previewData && (
                  <div className="text-xs flex items-center justify-between pt-1 border-t border-slate-200">
                    <span className="text-slate-600">Total ventilé :</span>
                    <span className={`font-mono font-bold ${isTotalBalanced ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {sumSplit.toFixed(3)} DT {isTotalBalanced ? '✓' : `(Différence : ${(sumSplit - expectedTotal).toFixed(3)} DT)`}
                    </span>
                  </div>
                )}

                {isCashOverCap && (
                  <p className="text-xs text-rose-600 font-semibold">
                    Le montant en espèces ({numCash.toFixed(3)} DT) dépasse la capacité d'espèces de la vente ({maxCashCap.toFixed(3)} DT).
                  </p>
                )}
                {isCreditOverCap && (
                  <p className="text-xs text-rose-600 font-semibold">
                    La réduction de dette ({numCredit.toFixed(3)} DT) dépasse la dette ouverte ({maxDebtCap.toFixed(3)} DT).
                  </p>
                )}
              </div>

              {/* Cash Refund Register Session Selector */}
              {numCash > 0 && (
                <div>
                  {openSessions.length === 0 ? (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-800 text-xs font-semibold">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                      <span>La caisse est fermée. Une session de caisse ouverte est obligatoire pour effectuer un remboursement en espèces.</span>
                    </div>
                  ) : openSessions.length === 1 ? (
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs flex items-center justify-between">
                      <span className="font-semibold text-slate-600">Caisse de remboursement (espèces) :</span>
                      <span className="font-bold text-slate-900 font-mono">{openSessions[0].counter_name} ({openSessions[0].session_number})</span>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Caisse effectuant le remboursement en espèces *
                      </label>
                      <select
                        value={selectedSessionId}
                        onChange={e => {
                          setSelectedSessionId(e.target.value);
                          setSessionTouched(true);
                        }}
                        className="w-full text-sm font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                      >
                        {openSessions.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.counter_name} — Session {s.session_number} ({formatMoney(s.opening_cash)})
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-600 mt-1">
                        Plusieurs caisses sont ouvertes. Choisissez la session de caisse qui décaisse le montant.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Return Reason */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Motif du retour
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2 rounded-xl text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <div className="shrink-0 p-3 sm:p-4 bg-slate-50 border-t border-slate-200 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 min-h-[44px] py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm transition-colors"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={isSubmitDisabled}
                className="flex-1 min-h-[44px] py-2.5 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-amber-950 font-bold rounded-xl text-sm shadow transition-colors flex items-center justify-center"
              >
                {isSubmitting ? 'Traitement...' : 'Confirmer le Remboursement & Réintégrer Stock'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
