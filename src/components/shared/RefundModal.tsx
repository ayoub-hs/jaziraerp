import React, { useState, useEffect } from 'react';
import { X, RotateCcw, Search, AlertCircle, CheckCircle, ArrowRight } from 'lucide-react';
import type { SaleSummary } from '../../types/index.js';
import { formatMoney, formatDateTime } from '../../utils/formatters.js';

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
  const [refundMethod, setRefundMethod] = useState<'CASH' | 'CREDIT_REDUCTION'>('CASH');
  const [reason, setReason] = useState<string>('Customer returned goods');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Register sessions for cash refunds
  const [openSessions, setOpenSessions] = useState<any[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [sessionTouched, setSessionTouched] = useState(false);

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

      // Fetch open register sessions
      fetch('/api/register/open-sessions')
        .then(res => res.ok ? res.json() : [])
        .then((sessions: any[]) => {
          setOpenSessions(sessions || []);
        })
        .catch(() => setOpenSessions([]));
    }
  }, [isOpen, initialSaleId]);

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
            (i: any) => (i.quantity || 0) - (i.refunded_quantity || 0) > 0
          );
          if (refundableItem) {
            setSelectedItemId(refundableItem.id);
            const remaining = (refundableItem.quantity || 0) - (refundableItem.refunded_quantity || 0);
            setRefundQuantity(remaining.toString());
          } else {
            setSelectedItemId(fullSale.items[0].id);
            setRefundQuantity('');
            setError('All items in this sale have already been fully refunded.');
          }
        }
        // Auto default to CREDIT_REDUCTION if original sale was credit-heavy
        if (fullSale.credit_amount > 0) {
          setRefundMethod('CREDIT_REDUCTION');
        } else {
          setRefundMethod('CASH');
        }
      }
      if (refundsRes.ok) {
        setSaleRefunds(await refundsRes.json());
      } else {
        setSaleRefunds([]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch sale details');
    } finally {
      setLoading(false);
    }
  };

  const handleProcessRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSale || !selectedItemId) return;

    const qty = parseFloat(refundQuantity);
    if (isNaN(qty) || qty <= 0) {
      setError('Refund quantity must be greater than 0');
      return;
    }

    const item = selectedSale.items?.find(i => i.id === selectedItemId);
    if (!item) {
      setError('Item not found in sale');
      return;
    }

    const maxAllowed = (item.quantity || 0) - (item.refunded_quantity || 0);
    if (qty > maxAllowed) {
      setError(`Cannot refund ${qty} units. Maximum refundable is ${maxAllowed}`);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales/${selectedSale.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refund_method: refundMethod,
          refund_to_credit_debt: refundMethod === 'CREDIT_REDUCTION',
          reason,
          session_id: refundMethod === 'CASH' ? selectedSessionId || undefined : undefined,
          items: [
            {
              sale_item_id: selectedItemId,
              quantity: qty
            }
          ]
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Refund failed');
      }

      setSuccess(`Refund completed successfully for ${qty} x ${item.description}`);
      onRefundCompleted();
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Error executing refund');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const currentItem = selectedSale?.items?.find(i => i.id === selectedItemId);
  const currentRemaining = currentItem ? (currentItem.quantity || 0) - (currentItem.refunded_quantity || 0) : 0;
  const isCashWithNoSession = refundMethod === 'CASH' && openSessions.length === 0;
  const isSubmitDisabled = isSubmitting || currentRemaining <= 0 || !refundQuantity || parseFloat(refundQuantity) <= 0 || isCashWithNoSession;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden flex flex-col border border-slate-200 max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-bold">Returns & Partial Refunds</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {success ? (
            <div className="text-center py-8 space-y-3">
              <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto" />
              <h3 className="text-lg font-bold text-slate-800">Refund Successful</h3>
              <p className="text-sm text-slate-600">{success}</p>
            </div>
          ) : !selectedSale ? (
            <div className="space-y-4">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  placeholder="Filter recent receipts..."
                  value={searchReceipt}
                  onChange={e => setSearchReceipt(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Select Recent Sale to Refund
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
                            {sale.customer_name || 'Walk-in'} • {formatDateTime(sale.date)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-sm text-slate-900 font-mono">
                            {formatMoney(sale.total_ttc)}
                          </div>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            sale.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {sale.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  {recentSales.length === 0 && (
                    <div className="p-4 text-center text-xs text-slate-500">
                      No recent sales found
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleProcessRefund} className="space-y-4">
              {/* Selected Sale Overview */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex justify-between items-center text-xs">
                <div>
                  <span className="font-bold text-slate-900 font-mono">{selectedSale.receipt_number}</span>
                  <div className="text-slate-500">
                    {selectedSale.customer_name || 'Walk-in'} • {formatDateTime(selectedSale.date)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSale(null)}
                  className="text-emerald-600 hover:text-emerald-800 font-bold underline"
                >
                  Change Sale
                </button>
              </div>

              {/* Prior Refunds for this Sale */}
              {saleRefunds.length > 0 && (
                <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3 space-y-2">
                  <h4 className="text-[11px] font-bold text-amber-900 uppercase tracking-wider">
                    Prior Refunds for this Receipt ({saleRefunds.length})
                  </h4>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {saleRefunds.map((rf: any) => (
                      <div key={rf.id} className="text-xs bg-white p-2 rounded-lg border border-amber-100 flex justify-between items-center">
                        <div>
                          <span className="font-bold text-slate-800">{formatMoney(rf.refund_amount)}</span> via <span className="font-semibold text-slate-600">{rf.refund_method}</span>
                          <div className="text-slate-500 text-[10px]">{rf.reason || 'No reason specified'} • {formatDateTime(rf.created_at)}</div>
                        </div>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">
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
                  Select Item to Return *
                </label>
                <select
                  value={selectedItemId}
                  onChange={e => {
                    setSelectedItemId(e.target.value);
                    const item = selectedSale.items?.find(i => i.id === e.target.value);
                    if (item) {
                      const remaining = (item.quantity || 0) - (item.refunded_quantity || 0);
                      if (remaining > 0) {
                        setRefundQuantity(remaining.toString());
                        setError(null);
                      } else {
                        setRefundQuantity('');
                        setError('This item has already been fully refunded.');
                      }
                    }
                  }}
                  className="w-full text-sm font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                >
                  {selectedSale.items?.map(item => {
                    const remaining = (item.quantity || 0) - (item.refunded_quantity || 0);
                    return (
                      <option key={item.id} value={item.id} disabled={remaining <= 0}>
                        {item.description} — {formatMoney(item.unit_price)} (Purchased: {item.quantity}, Remaining: {remaining})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Quantity */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Refund Quantity *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.001"
                    value={refundQuantity}
                    onChange={e => setRefundQuantity(e.target.value)}
                    className="w-full text-sm font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                {/* Refund Method */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Refund Method *
                  </label>
                  <select
                    value={refundMethod}
                    onChange={e => setRefundMethod(e.target.value as any)}
                    className="w-full text-sm font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  >
                    <option value="CASH">Cash Refund</option>
                    <option value="CREDIT_REDUCTION">Credit Reduction</option>
                  </select>
                </div>
              </div>

              {/* Cash Refund Register Session Selector */}
              {refundMethod === 'CASH' && (
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
                      <p className="text-[11px] text-slate-400 mt-1">
                        Plusieurs caisses sont ouvertes. Choisissez la session de caisse qui décaisse le montant.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Return Reason */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Return Reason
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

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitDisabled}
                  className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm shadow transition-colors"
                >
                  {isSubmitting ? 'Refunding...' : 'Confirm Refund & Restock'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
