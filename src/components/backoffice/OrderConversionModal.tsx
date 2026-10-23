import React, { useState, useEffect } from 'react';
import { 
  X, 
  DollarSign, 
  CheckCircle2, 
  AlertCircle, 
  AlertTriangle, 
  Printer, 
  PackageCheck, 
  Truck, 
  Plus, 
  Trash2,
  RefreshCw,
  Wallet,
  CreditCard,
  Banknote
} from 'lucide-react';
import type { ClientOrder, ContainerType } from '../../types/index.js';
import { formatMoney, roundMoney } from '../../utils/formatters.js';
import { useRequestKey } from '../../hooks/useRequestKey.js';
import { useBackButton } from '../../utils/backButton.js';
import { useModalScanPause } from '../../hooks/useModalScanPause.js';

interface OrderConversionModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: ClientOrder | null;
  containerTypes?: ContainerType[];
  onSuccess?: () => void;
  onPrintDeliveryNote?: (saleId: string) => void;
}

export const OrderConversionModal: React.FC<OrderConversionModalProps> = ({
  isOpen,
  onClose,
  order,
  containerTypes = [],
  onSuccess,
  onPrintDeliveryNote
}) => {
  useModalScanPause(isOpen);
  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  const { keyFor, clear: clearRequestKey } = useRequestKey();

  // Session state
  const [activeSession, setActiveSession] = useState<any | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [noSession, setNoSession] = useState(false);
  const [openingCash, setOpeningCash] = useState('0.000');
  const [isOpeningSession, setIsOpeningSession] = useState(false);

  // Delivered quantities: item.id -> quantity
  const [deliveredQuantities, setDeliveredQuantities] = useState<Record<string, number>>({});
  
  // Tender Split
  const [cashPaid, setCashPaid] = useState('');
  const [walletPaid, setWalletPaid] = useState('0');
  const [creditAmount, setCreditAmount] = useState('0');

  // Containers (customers only)
  const [containersReturned, setContainersReturned] = useState<Array<{ container_type_id: string; quantity: number }>>([]);
  const [containersLoaned, setContainersLoaned] = useState<Array<{ container_type_id: string; quantity: number }>>([]);

  // Submitting / Result state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversionResult, setConversionResult] = useState<{
    sale: any;
    delivery_note_number: string;
    warnings: string[];
  } | null>(null);

  useEffect(() => {
    if (isOpen && order) {
      checkLivraisonSession();
      initializeForm(order);
    } else {
      setActiveSession(null);
      setNoSession(false);
      setConversionResult(null);
      setError(null);
    }
  }, [isOpen, order]);

  const checkLivraisonSession = async () => {
    try {
      setSessionLoading(true);
      setNoSession(false);
      const res = await fetch('/api/register/current?counter_name=Livraison');
      if (res.ok) {
        const data = await res.json();
        setActiveSession(data);
        setNoSession(false);
      } else {
        setActiveSession(null);
        setNoSession(true);
      }
    } catch {
      setActiveSession(null);
      setNoSession(true);
    } finally {
      setSessionLoading(false);
    }
  };

  const handleOpenSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsOpeningSession(true);
    setError(null);
    try {
      const res = await fetch('/api/register/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          counter_name: 'Livraison',
          opening_cash: parseFloat(openingCash) || 0
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erreur lors de l'ouverture de la session Livraison");
      }
      const newSession = await res.json();
      setActiveSession(newSession);
      setNoSession(false);
    } catch (err: any) {
      setError(err.message || "Impossible d'ouvrir la session Livraison");
    } finally {
      setIsOpeningSession(false);
    }
  };

  const initializeForm = (ord: ClientOrder) => {
    const initialDelivered: Record<string, number> = {};
    let subtotal = 0;
    if (ord.items) {
      for (const item of ord.items) {
        initialDelivered[item.id] = item.ordered_quantity;
        subtotal += item.ordered_quantity * item.unit_price_ttc;
      }
    }
    setDeliveredQuantities(initialDelivered);
    const initialTotal = roundMoney(subtotal + (ord.delivery_fee || 0));
    setCashPaid(String(initialTotal));
    setWalletPaid('0');
    setCreditAmount('0');
    setContainersReturned([]);
    setContainersLoaned([]);
    setConversionResult(null);
    setError(null);
  };

  if (!isOpen || !order) return null;

  // Calculate live total
  let computedSubtotal = 0;
  let hasQuantityExceeded = false;
  let hasNegativeQuantity = false;

  if (order.items) {
    for (const item of order.items) {
      const dQty = deliveredQuantities[item.id] ?? item.ordered_quantity;
      if (dQty > item.ordered_quantity) {
        hasQuantityExceeded = true;
      }
      if (dQty < 0) {
        hasNegativeQuantity = true;
      }
      computedSubtotal += (dQty > 0 ? dQty : 0) * item.unit_price_ttc;
    }
  }

  const computedTotal = roundMoney(computedSubtotal + (order.delivery_fee || 0));
  const parsedCash = parseFloat(cashPaid) || 0;
  const parsedWallet = parseFloat(walletPaid) || 0;
  const parsedCredit = parseFloat(creditAmount) || 0;
  const tenderSum = roundMoney(parsedCash + parsedWallet + parsedCredit);
  const tenderDiff = roundMoney(tenderSum - computedTotal);
  const isTenderBalanced = Math.abs(tenderDiff) < 0.001;

  const isFormValid =
    !hasQuantityExceeded &&
    !hasNegativeQuantity &&
    isTenderBalanced &&
    !noSession &&
    !sessionLoading;

  const handleQuantityChange = (itemId: string, maxOrdered: number, rawVal: string) => {
    const val = rawVal === '' ? 0 : parseFloat(rawVal);
    setDeliveredQuantities(prev => {
      const next = { ...prev, [itemId]: val };
      // Recalculate default cash tendered
      let newSub = 0;
      for (const it of order.items || []) {
        const q = it.id === itemId ? val : (next[it.id] ?? it.ordered_quantity);
        newSub += (q > 0 ? q : 0) * it.unit_price_ttc;
      }
      const newTot = roundMoney(newSub + (order.delivery_fee || 0));
      setCashPaid(String(newTot));
      setWalletPaid('0');
      setCreditAmount('0');
      return next;
    });
  };

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;

    setIsSubmitting(true);
    setError(null);

    const basePayload = {
      delivered_items: (order.items || []).map(it => ({
        order_item_id: it.id,
        delivered_quantity: deliveredQuantities[it.id] ?? it.ordered_quantity
      })),
      cash_paid: parsedCash,
      wallet_paid: parsedWallet,
      credit_amount: parsedCredit,
      containers_returned: containersReturned.filter(c => c.quantity > 0),
      containers_borrowed: containersLoaned.filter(c => c.quantity > 0)
    };

    const clientRequestId = keyFor(JSON.stringify(basePayload));
    const fullPayload = {
      ...basePayload,
      client_request_id: clientRequestId
    };

    try {
      const res = await fetch(`/api/orders/${order.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullPayload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Erreur lors de la conversion de la commande en vente');
      }

      clearRequestKey();
      setConversionResult({
        sale: data.sale,
        delivery_note_number: data.delivery_note_number,
        warnings: data.warnings || []
      });
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la conversion');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                Conversion en Vente & Bon de Livraison
              </h3>
              <p className="text-[11px] font-mono text-slate-500">
                <span>{order.order_number}</span> — <span>{order.customer_name || order.guest_name || 'Client de passage'}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 text-xs">
          {/* Success Screen */}
          {conversionResult ? (
            <div className="py-6 text-center space-y-5 animate-in fade-in">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">
                  Commande convertie avec succès en Vente !
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Vente enregistrée sur le comptoir Livraison. Bon de livraison généré.
                </p>
              </div>

              {/* Warnings Banner if credit limit exceeded */}
              {conversionResult.warnings.length > 0 && (
                <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-left text-amber-900 flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
                  <div className="space-y-0.5">
                    <span className="font-black text-xs">Avertissement :</span>
                    {conversionResult.warnings.map((w, idx) => (
                      <p key={idx} className="text-xs font-semibold">{w}</p>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 max-w-sm mx-auto text-left space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-600">Reçu N° :</span>
                  <span className="font-mono font-bold text-slate-900">{conversionResult.sale.receipt_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Bon de Livraison N° :</span>
                  <span className="font-mono font-black text-emerald-700">{conversionResult.delivery_note_number}</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5 justify-center pt-2">
                {onPrintDeliveryNote && (
                  <button
                    type="button"
                    onClick={() => onPrintDeliveryNote(conversionResult.sale.id)}
                    className="min-h-[44px] px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-sm transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Imprimer le Bon de Livraison</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[44px] px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-colors"
                >
                  Fermer
                </button>
              </div>
            </div>
          ) : noSession ? (
            /* Open Livraison Session Prompt */
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-3">
              <div className="flex items-center gap-2 text-amber-900 font-bold">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                <span>Aucune session de caisse ouverte sur le comptoir Livraison</span>
              </div>
              <p className="text-slate-600 text-xs">
                Pour convertir une commande en vente, une session de caisse dédiée au comptoir « Livraison » doit être ouverte.
              </p>
              <form onSubmit={handleOpenSession} className="space-y-3 pt-2">
                <div>
                  <label htmlFor="open-cash-input" className="block font-bold text-slate-700 mb-1">
                    Fond de caisse initial (DT)
                  </label>
                  <input
                    id="open-cash-input"
                    type="number"
                    min="0"
                    step="0.001"
                    value={openingCash}
                    onChange={e => setOpeningCash(e.target.value)}
                    className="w-full font-mono font-bold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none bg-white"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isOpeningSession}
                  className="min-h-[44px] w-full py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isOpeningSession ? 'Ouverture...' : 'Ouvrir la session Livraison'}</span>
                </button>
              </form>
            </div>
          ) : (
            /* Conversion Form */
            <form onSubmit={handleConvert} className="space-y-4">
              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span className="font-semibold">{error}</span>
                </div>
              )}

              {/* Items Delivered Reconciliation */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block font-black text-slate-800 uppercase tracking-wider text-[11px]">
                    Articles & Quantités Livrées
                  </label>
                  <span className="text-slate-500 text-[11px] italic">0 = refusé à la livraison</span>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 bg-white">
                  {order.items?.map(it => {
                    const currentDQty = deliveredQuantities[it.id] ?? it.ordered_quantity;
                    const isExceeded = currentDQty > it.ordered_quantity;
                    return (
                      <div key={it.id} className="p-3 flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-900 truncate">
                            <span>{it.product_name || 'Produit'}</span>
                            {it.size_label && <span className="ml-1 text-slate-500 font-normal">({it.size_label})</span>}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                            Commandé : {it.ordered_quantity} × {formatMoney(it.unit_price_ttc)} = {formatMoney(it.ordered_quantity * it.unit_price_ttc)}
                          </div>
                          {isExceeded && (
                            <div className="text-[11px] text-rose-600 font-bold mt-0.5">
                              La quantité livrée ne peut pas dépasser la quantité commandée ({it.ordered_quantity}).
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <label htmlFor={`del-qty-${it.id}`} className="sr-only">
                            Quantité livrée
                          </label>
                          <input
                            id={`del-qty-${it.id}`}
                            aria-label="Quantité livrée"
                            type="number"
                            min="0"
                            max={it.ordered_quantity}
                            step="any"
                            value={currentDQty}
                            onChange={e => handleQuantityChange(it.id, it.ordered_quantity, e.target.value)}
                            className={`w-20 font-mono font-black text-sm text-center px-2 py-1.5 border rounded-lg focus:ring-2 outline-none ${
                              isExceeded ? 'border-rose-400 focus:ring-rose-400 bg-rose-50' : 'border-slate-300 focus:ring-emerald-500'
                            }`}
                          />
                          <div className="w-24 text-right font-mono font-bold text-slate-900">
                            {formatMoney((currentDQty > 0 ? currentDQty : 0) * it.unit_price_ttc)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Total & Delivery Fee Summary */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-1.5">
                <div className="flex justify-between text-slate-600">
                  <span>Sous-total articles livrés :</span>
                  <span className="font-mono font-semibold">{formatMoney(computedSubtotal)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Frais de livraison ({order.delivery_zone_name || 'Zone'}) :</span>
                  <span className="font-mono font-semibold">+{formatMoney(order.delivery_fee)}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-slate-200 text-sm font-black text-slate-900">
                  <span>TOTAL TTC À RÉGLER :</span>
                  <span className="font-mono text-base text-emerald-700">
                    {formatMoney(computedTotal)}
                  </span>
                </div>
              </div>

              {/* Tender Split: Cash / Wallet / Credit */}
              <div className="space-y-2 pt-1">
                <label className="block font-black text-slate-800 uppercase tracking-wider text-[11px]">
                  Ventilation du Règlement *
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {/* Cash */}
                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                    <label htmlFor="tender-cash" className="block font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                      <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Espèces</span>
                    </label>
                    <input
                      id="tender-cash"
                      type="number"
                      min="0"
                      step="0.001"
                      value={cashPaid}
                      onChange={e => setCashPaid(e.target.value)}
                      className="w-full font-mono font-bold px-2 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                    />
                  </div>

                  {/* Wallet */}
                  <div className={`p-2.5 rounded-xl border ${!order.customer_id ? 'bg-slate-100 border-slate-200 opacity-60' : 'bg-slate-50 border-slate-200'}`}>
                    <label htmlFor="tender-wallet" className="block font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5 text-blue-600" />
                      <span>Portefeuille client</span>
                    </label>
                    <input
                      id="tender-wallet"
                      type="number"
                      min="0"
                      step="0.001"
                      disabled={!order.customer_id}
                      value={walletPaid}
                      onChange={e => setWalletPaid(e.target.value)}
                      className="w-full font-mono font-bold px-2 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white disabled:bg-slate-200 disabled:cursor-not-allowed"
                    />
                    {!order.customer_id && (
                      <span className="text-[10px] text-slate-500 mt-0.5 block">Client invité</span>
                    )}
                  </div>

                  {/* Credit */}
                  <div className={`p-2.5 rounded-xl border ${!order.customer_id ? 'bg-slate-100 border-slate-200 opacity-60' : 'bg-slate-50 border-slate-200'}`}>
                    <label htmlFor="tender-credit" className="block font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                      <CreditCard className="w-3.5 h-3.5 text-purple-600" />
                      <span>Vente à crédit</span>
                    </label>
                    <input
                      id="tender-credit"
                      type="number"
                      min="0"
                      step="0.001"
                      disabled={!order.customer_id}
                      value={creditAmount}
                      onChange={e => setCreditAmount(e.target.value)}
                      className="w-full font-mono font-bold px-2 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none bg-white disabled:bg-slate-200 disabled:cursor-not-allowed"
                    />
                    {!order.customer_id && (
                      <span className="text-[10px] text-slate-500 mt-0.5 block">Client invité</span>
                    )}
                  </div>
                </div>

                {/* Tender Balance Indicator */}
                {!isTenderBalanced && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-rose-800 font-semibold">
                    <span>Le total des règlements doit être égal au total TTC</span>
                    <span className="font-mono font-bold">
                      Écart : {tenderDiff > 0 ? `+${formatMoney(tenderDiff)}` : formatMoney(tenderDiff)} DT
                    </span>
                  </div>
                )}
              </div>

              {/* Containers Returns and Loans (Customers Only) */}
              {order.customer_id && containerTypes.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <label className="block font-black text-slate-800 uppercase tracking-wider text-[11px]">
                      Gestion des Consignes (Retours & Prêts)
                    </label>
                  </div>

                  {/* Returns */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-700">Emballages Retournés par le Client</span>
                      <button
                        type="button"
                        onClick={() => setContainersReturned(prev => [...prev, { container_type_id: containerTypes[0].id, quantity: 1 }])}
                        className="text-emerald-700 hover:text-emerald-800 font-bold flex items-center gap-1 text-[11px]"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Ajouter retour</span>
                      </button>
                    </div>
                    {containersReturned.map((c, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <select
                          value={c.container_type_id}
                          onChange={e => {
                            const val = e.target.value;
                            setContainersReturned(prev => prev.map((item, i) => i === idx ? { ...item, container_type_id: val } : item));
                          }}
                          className="flex-1 font-semibold px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                        >
                          {containerTypes.map(ct => (
                            <option key={ct.id} value={ct.id}>{ct.name}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="1"
                          value={c.quantity}
                          onChange={e => {
                            const q = parseInt(e.target.value) || 0;
                            setContainersReturned(prev => prev.map((item, i) => i === idx ? { ...item, quantity: q } : item));
                          }}
                          className="w-16 font-mono font-bold text-center px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => setContainersReturned(prev => prev.filter((_, i) => i !== idx))}
                          className="p-1.5 text-rose-600 hover:text-rose-800"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Loans */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-700">Emballages Prêtés / Emportés</span>
                      <button
                        type="button"
                        onClick={() => setContainersLoaned(prev => [...prev, { container_type_id: containerTypes[0].id, quantity: 1 }])}
                        className="text-amber-700 hover:text-amber-800 font-bold flex items-center gap-1 text-[11px]"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Ajouter prêt</span>
                      </button>
                    </div>
                    {containersLoaned.map((c, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <select
                          value={c.container_type_id}
                          onChange={e => {
                            const val = e.target.value;
                            setContainersLoaned(prev => prev.map((item, i) => i === idx ? { ...item, container_type_id: val } : item));
                          }}
                          className="flex-1 font-semibold px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                        >
                          {containerTypes.map(ct => (
                            <option key={ct.id} value={ct.id}>{ct.name}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="1"
                          value={c.quantity}
                          onChange={e => {
                            const q = parseInt(e.target.value) || 0;
                            setContainersLoaned(prev => prev.map((item, i) => i === idx ? { ...item, quantity: q } : item));
                          }}
                          className="w-16 font-mono font-bold text-center px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => setContainersLoaned(prev => prev.filter((_, i) => i !== idx))}
                          className="p-1.5 text-rose-600 hover:text-rose-800"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Modal Actions */}
              <div className="pt-3 border-t border-slate-100 flex gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 min-h-[44px] py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={!isFormValid || isSubmitting}
                  className="flex-1 min-h-[44px] py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
                >
                  <DollarSign className="w-4 h-4" />
                  <span>
                    {isSubmitting ? 'Validation...' : 'Valider la conversion en Vente'}
                  </span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
