import React, { useState, useEffect } from 'react';
import { 
  X, 
  CheckCircle, 
  Printer, 
  FileText, 
  RotateCcw, 
  Wallet, 
  CreditCard, 
  Banknote, 
  AlertCircle,
  Package,
  Tag
} from 'lucide-react';
import type { Customer, CartItem, RegisterSession } from '../../types/index.js';
import { calculateCartTotals, validateSplitPayment, calculateContainersNeeded } from '../../utils/cart.js';
import { formatMoney, roundMoney } from '../../utils/formatters.js';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  customer: Customer | null;
  saleDiscount?: number;
  activeSession?: RegisterSession | null;
  onOpenSessionModal?: () => void;
  onCompleteSale: (tender: {
    cash_paid: number;
    wallet_paid: number;
    credit_amount: number;
    total_discount?: number;
  }) => Promise<{ sale_id: string; receipt_number: string } | null>;
  onPrintReceipt: (saleId: string) => void;
  onPrintInvoice: (saleId: string) => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  items,
  customer,
  saleDiscount = 0,
  activeSession,
  onOpenSessionModal,
  onCompleteSale,
  onPrintReceipt,
  onPrintInvoice
}) => {
  const totals = calculateCartTotals(items, saleDiscount);
  const totalTTC = totals.totalTTC;

  const [cashPaid, setCashPaid] = useState<string>('');
  const [walletPaid, setWalletPaid] = useState<string>('');
  const [creditAmount, setCreditAmount] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [changeDue, setChangeDue] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [completedSale, setCompletedSale] = useState<{ sale_id: string; receipt_number: string } | null>(null);
  const [isPrintingDirect, setIsPrintingDirect] = useState(false);
  const [printSuccessMessage, setPrintSuccessMessage] = useState<string | null>(null);

  // Initialize tender when modal opens
  useEffect(() => {
    if (isOpen) {
      setCashPaid(totalTTC.toFixed(3));
      setWalletPaid('0.000');
      setCreditAmount('0.000');
      setValidationError(null);
      setChangeDue(0);
      setIsSubmitting(false);
      setCompletedSale(null);
    }
  }, [isOpen, totalTTC]);

  // Recalculate validation & change due
  useEffect(() => {
    if (!isOpen || completedSale) return;

    const cash = parseFloat(cashPaid) || 0;
    const wallet = parseFloat(walletPaid) || 0;
    const credit = parseFloat(creditAmount) || 0;

    const res = validateSplitPayment(totalTTC, cash, wallet, credit, customer);
    if (!res.valid) {
      setValidationError(res.error || 'Invalid payment amounts');
      setChangeDue(0);
    } else {
      setValidationError(null);
      setChangeDue(res.changeDue);
    }
  }, [cashPaid, walletPaid, creditAmount, totalTTC, customer, isOpen, completedSale]);

  if (!isOpen) return null;

  const handleQuickCash = (amount: number) => {
    setCashPaid(amount.toFixed(3));
    setCreditAmount('0.000');
  };

  const handleApplyMaxWallet = () => {
    if (!customer || customer.wallet_balance <= 0) return;
    const maxUsable = Math.min(totalTTC, roundMoney(customer.wallet_balance));
    setWalletPaid(maxUsable.toFixed(3));
    const remainder = roundMoney(totalTTC - maxUsable);
    
    const currentCredit = parseFloat(creditAmount) || 0;
    if (currentCredit > 0) {
      setCreditAmount(remainder.toFixed(3));
      setCashPaid('0.000');
    } else {
      setCashPaid(remainder.toFixed(3));
      setCreditAmount('0.000');
    }
  };

  const handleApplyCredit = () => {
    if (!customer) return;
    const currentWallet = parseFloat(walletPaid) || 0;
    const remaining = Math.max(0, roundMoney(totalTTC - currentWallet));
    setCreditAmount(remaining.toFixed(3));
    setCashPaid('0.000');
  };

  const handleSubmit = async () => {
    const cash = parseFloat(cashPaid) || 0;
    const wallet = parseFloat(walletPaid) || 0;
    const credit = parseFloat(creditAmount) || 0;

    const res = validateSplitPayment(totalTTC, cash, wallet, credit, customer);
    if (!res.valid) {
      setValidationError(res.error || 'Validation failed');
      return;
    }

    if (activeSession !== undefined && (!activeSession || activeSession.status !== 'OPEN')) {
      setValidationError('La caisse est fermée. Une session de caisse ouverte est obligatoire pour finaliser la vente.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await onCompleteSale({
        cash_paid: cash,
        wallet_paid: wallet,
        credit_amount: credit,
        total_discount: saleDiscount || 0
      });
      if (result) {
        setCompletedSale(result);
      }
    } catch (err: any) {
      setValidationError(err.message || 'Error processing checkout');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrint58mm = async () => {
    if (!completedSale) return;
    setIsPrintingDirect(true);
    setPrintSuccessMessage(null);

    try {
      const targetId = completedSale.sale_id || completedSale.receipt_number;
      const salePayload = {
        receipt_number: completedSale.receipt_number,
        date: new Date().toISOString(),
        customer_name: customer?.name || 'Client Passager',
        subtotal_ht: totals.subtotalHT,
        tva_amount: totals.tvaAmount,
        total_ttc: totals.totalTTC,
        total_discount: saleDiscount || 0,
        cash_paid: parseFloat(cashPaid) || 0,
        wallet_paid: parseFloat(walletPaid) || 0,
        credit_amount: parseFloat(creditAmount) || 0,
        change_given: changeDue || 0,
        items: items.map(item => ({
          catalog_product_name: item.name,
          description: item.name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          pack_multiplier: item.pack_multiplier || 1,
          discount_amount: item.discount_amount || 0,
          line_total: Math.max(0, (item.unit_price * item.quantity) - (item.discount_amount || 0))
        }))
      };

      const res = await fetch('/api/hardware/printer/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sale_id: targetId, sale: salePayload })
      });
      if (res.ok) {
        setPrintSuccessMessage('Ticket imprimé avec succès !');
        setTimeout(() => setPrintSuccessMessage(null), 3500);
        return;
      }
    } catch (err) {
      console.warn('Direct printer call failed:', err);
    } finally {
      setIsPrintingDirect(false);
    }

    // Fallback: If hardware printer call didn't succeed, open preview modal
    onPrintReceipt(completedSale.sale_id || completedSale.receipt_number);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col border border-slate-200">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">
              {completedSale ? 'Sale Completed' : 'Tender & Split Payment'}
            </h2>
            <p className="text-xs text-slate-400">
              {customer ? `${customer.name} (${customer.type})` : 'Walk-in Retail Customer'}
            </p>
          </div>
          {!completedSale && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 flex-1 space-y-5">
          {completedSale ? (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle className="w-10 h-10" />
              </div>
              <h3 className="text-xl font-bold text-slate-800">
                Transaction Successful!
              </h3>
              <p className="text-sm font-semibold text-slate-500">
                Receipt Number: <span className="text-slate-900 font-mono">{completedSale.receipt_number}</span>
              </p>
              {changeDue > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 inline-block">
                  <span className="text-xs font-semibold text-emerald-800 uppercase block">Change Given</span>
                  <span className="text-2xl font-black text-emerald-700">{formatMoney(changeDue)}</span>
                </div>
              )}

              {printSuccessMessage && (
                <div className="block">
                  <span className="inline-block bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold py-2 px-4 rounded-xl animate-pulse shadow-sm">
                    ✓ {printSuccessMessage}
                  </span>
                </div>
              )}

              <div className="pt-4 flex flex-col sm:flex-row gap-3 justify-center items-center">
                <button
                  type="button"
                  onClick={handlePrint58mm}
                  disabled={isPrintingDirect}
                  className={`flex items-center justify-center gap-2 font-bold py-2.5 px-4 rounded-xl shadow transition-colors ${
                    printSuccessMessage
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-slate-800 hover:bg-slate-900 text-white'
                  }`}
                >
                  <Printer className={`w-4 h-4 ${isPrintingDirect ? 'animate-spin' : ''}`} />
                  {isPrintingDirect ? 'Impression...' : printSuccessMessage ? 'Imprimé !' : 'Print 58mm Receipt'}
                </button>
                <button
                  type="button"
                  onClick={() => onPrintInvoice(completedSale.sale_id)}
                  className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded-xl shadow transition-colors"
                >
                  <FileText className="w-4 h-4" />
                  Print A4 Invoice
                </button>
              </div>

              <div className="flex justify-center gap-4 text-xs pt-1">
                <button
                  type="button"
                  onClick={() => onPrintReceipt(completedSale.sale_id)}
                  className="text-slate-400 hover:text-slate-600 underline"
                >
                  Aperçu du ticket
                </button>
              </div>

              <div className="pt-2">
                <button
                  onClick={onClose}
                  className="text-slate-600 hover:text-slate-900 font-semibold text-sm underline"
                >
                  Start Next Sale
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Total Due Banner */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Total Due (TTC)
                  </span>
                  <div className="text-3xl font-black text-slate-900 tracking-tight">
                    {formatMoney(totalTTC)}
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>Subtotal HT: {formatMoney(totals.subtotalHT)}</div>
                  <div>TVA (19%): {formatMoney(totals.tvaAmount)}</div>
                </div>
              </div>

              {/* Closed Register Notice */}
              {activeSession !== undefined && (!activeSession || activeSession.status !== 'OPEN') && (
                <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs font-semibold gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Caisse fermée — Session obligatoire pour finaliser la vente.</span>
                  </div>
                  {onOpenSessionModal && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenSessionModal();
                      }}
                      className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-2.5 py-1 rounded-lg text-xs shrink-0 transition-colors shadow-xs"
                    >
                      Ouvrir la caisse
                    </button>
                  )}
                </div>
              )}

              {/* Discount Summary if applied */}
              {totals.totalDiscount > 0 && (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-3 py-2 flex items-center justify-between text-xs font-bold">
                  <span className="flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-amber-600" />
                    Remises appliquées (Articles + Vente) :
                  </span>
                  <span className="font-mono text-amber-700">-{formatMoney(totals.totalDiscount)}</span>
                </div>
              )}

              {/* Loaned Containers Notice */}
              {(() => {
                const totalLoaned = items.filter(i => i.loan_container).reduce((sum, i) => sum + calculateContainersNeeded(i.quantity, i.pack_multiplier, i.size_label, i.container_capacity_liters, i.name), 0);
                if (totalLoaned <= 0) return null;
                return (
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl px-3 py-2 flex items-center gap-2 text-xs">
                    <Package className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      <strong>Consignes prêtées ({totalLoaned} pcs)</strong> enregistrées pour le client <strong>{customer ? customer.name : 'Passager'}</strong>.
                    </span>
                  </div>
                );
              })()}

              {/* Quick Cash Buttons */}
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1.5 block">
                  Quick Cash Tender
                </label>
                <div className="grid grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const currentWallet = parseFloat(walletPaid) || 0;
                      const remaining = Math.max(0, roundMoney(totalTTC - currentWallet));
                      setCashPaid(remaining.toFixed(3));
                      setCreditAmount('0.000');
                    }}
                    className="py-2 px-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold border border-slate-200 transition-colors"
                  >
                    Exact {(parseFloat(walletPaid) || 0) > 0 ? `(${formatMoney(Math.max(0, roundMoney(totalTTC - (parseFloat(walletPaid) || 0))))})` : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickCash(10)}
                    className="py-2 px-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold border border-slate-200 transition-colors"
                  >
                    10 DT
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickCash(20)}
                    className="py-2 px-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold border border-slate-200 transition-colors"
                  >
                    20 DT
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickCash(50)}
                    className="py-2 px-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-bold border border-slate-200 transition-colors"
                  >
                    50 DT
                  </button>
                </div>
              </div>

              {/* Split Tender Inputs */}
              <div className="space-y-3">
                {/* Cash Tender */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Banknote className="w-4 h-4 text-emerald-600" />
                      Cash Tendered (DT)
                    </span>
                    {customer && ((parseFloat(walletPaid) || 0) > 0 || (parseFloat(creditAmount) || 0) > 0) && (
                      <button
                        type="button"
                        onClick={() => {
                          const currentWallet = parseFloat(walletPaid) || 0;
                          const remaining = Math.max(0, roundMoney(totalTTC - currentWallet));
                          setCashPaid(remaining.toFixed(3));
                          setCreditAmount('0.000');
                        }}
                        className="text-[11px] font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 px-2 py-0.5 rounded transition-colors"
                      >
                        Pay Remaining ({formatMoney(Math.max(0, roundMoney(totalTTC - (parseFloat(walletPaid) || 0))))})
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={cashPaid}
                    onFocus={e => e.target.select()}
                    onChange={e => setCashPaid(e.target.value)}
                    className="w-full text-lg font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    placeholder="0.000"
                  />
                </div>

                {/* Customer Wallet */}
                {customer && (
                  <div className="bg-purple-50/60 border border-purple-200/80 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-purple-900 flex items-center gap-1.5">
                        <Wallet className="w-4 h-4 text-purple-600" />
                        Wallet Payment (Balance: {formatMoney(customer.wallet_balance)})
                      </span>
                      {customer.wallet_balance > 0 && (
                        <button
                          type="button"
                          onClick={handleApplyMaxWallet}
                          className="text-[11px] font-bold text-purple-700 bg-purple-100 hover:bg-purple-200 px-2 py-0.5 rounded transition-colors"
                        >
                          Use Max
                        </button>
                      )}
                    </div>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      max={customer.wallet_balance}
                      disabled={customer.wallet_balance <= 0}
                      value={walletPaid}
                      onFocus={e => e.target.select()}
                      onChange={e => setWalletPaid(e.target.value)}
                      className="w-full text-base font-bold font-mono px-3 py-1.5 border border-purple-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                      placeholder="0.000"
                    />
                  </div>
                )}

                {/* Credit Ticket */}
                {customer && (
                  <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                        <CreditCard className="w-4 h-4 text-amber-600" />
                        Open Credit Ticket (DT)
                      </span>
                      <button
                        type="button"
                        onClick={handleApplyCredit}
                        className="text-[11px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded transition-colors"
                      >
                        {(parseFloat(walletPaid) || 0) > 0
                          ? `Charge Remaining (${formatMoney(Math.max(0, roundMoney(totalTTC - (parseFloat(walletPaid) || 0))))})`
                          : 'Charge All'}
                      </button>
                    </div>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={creditAmount}
                      onFocus={e => e.target.select()}
                      onChange={e => setCreditAmount(e.target.value)}
                      className="w-full text-base font-bold font-mono px-3 py-1.5 border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                      placeholder="0.000"
                    />
                  </div>
                )}
              </div>

              {/* Change Due Display */}
              <div className="flex items-center justify-between bg-emerald-50/80 border border-emerald-200 rounded-xl px-4 py-3">
                <span className="text-sm font-bold text-emerald-900">
                  Change Due to Customer:
                </span>
                <span className="text-2xl font-black text-emerald-700 font-mono">
                  {formatMoney(changeDue)}
                </span>
              </div>

              {/* Validation Error */}
              {validationError && (
                <div className="flex items-center gap-2 text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2 rounded-xl text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{validationError}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={Boolean(validationError) || isSubmitting || (activeSession !== undefined && (!activeSession || activeSession.status !== 'OPEN'))}
                  onClick={handleSubmit}
                  className="flex-[2] py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 text-white font-extrabold rounded-xl shadow-lg transition-all"
                >
                  {isSubmitting
                    ? 'Processing...'
                    : activeSession !== undefined && (!activeSession || activeSession.status !== 'OPEN')
                    ? 'Caisse fermée'
                    : 'Complete Sale & Pop Drawer'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
