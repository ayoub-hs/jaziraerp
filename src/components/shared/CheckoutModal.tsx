import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Tag,
  Truck
} from 'lucide-react';
import type { Customer, CartItem, RegisterSession } from '../../types/index.js';
import { calculateCartTotals, validateSplitPayment, buildPaymentPayload, calculateContainersNeeded } from '../../utils/cart.js';
import { formatMoney, roundMoney } from '../../utils/formatters.js';
import { webUsbPrinter } from '../../services/hardware/webusb.js';
import { webBluetoothPrinter } from '../../services/hardware/webbluetooth.js';
import { nativeSppPrinter } from '../../services/hardware/nativeSpp.js';
import { registerBackHandler } from '../../utils/backButton.js';
import { useModalScanPause } from '../../hooks/useModalScanPause.js';

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
    cash_tendered: number;
    wallet_paid: number;
    credit_amount: number;
    total_discount?: number;
  }) => Promise<{ sale_id: string; receipt_number: string } | null>;
  onPrintReceipt: (saleId: string) => void;
  onPrintInvoice: (saleId: string) => void;
  onPrintDeliveryNote?: (saleId: string) => void;
  onSaleDone?: () => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  onSaleDone,
  items,
  customer,
  saleDiscount = 0,
  activeSession,
  onOpenSessionModal,
  onCompleteSale,
  onPrintReceipt,
  onPrintInvoice,
  onPrintDeliveryNote
}) => {
  useModalScanPause(isOpen);

  const totals = calculateCartTotals(items, saleDiscount);
  const totalTTC = totals.totalTTC;

  const [cashPaid, setCashPaid] = useState<string>('');
  const [walletPaid, setWalletPaid] = useState<string>('');
  const [creditAmount, setCreditAmount] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [changeDue, setChangeDue] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false);
  const cashInputRef = useRef<HTMLInputElement>(null);
  const startNextSaleBtnRef = useRef<HTMLButtonElement>(null);
  const [completedSale, setCompletedSale] = useState<{ sale_id: string; receipt_number: string } | null>(null);
  const [isPrintingDirect, setIsPrintingDirect] = useState(false);
  const [printSuccessMessage, setPrintSuccessMessage] = useState<string | null>(null);
  const [highChangeConfirmed, setHighChangeConfirmed] = useState<boolean>(false);
  const [scannerError, setScannerError] = useState<string | null>(null);

  // Initialize tender when modal opens & auto-focus
  useEffect(() => {
    if (isOpen) {
      setCashPaid(totalTTC.toFixed(3));
      setWalletPaid('0.000');
      setCreditAmount('0.000');
      setValidationError(null);
      setScannerError(null);
      setChangeDue(0);
      setIsSubmitting(false);
      isSubmittingRef.current = false;
      setCompletedSale(null);
      setHighChangeConfirmed(false);
      setTimeout(() => {
        cashInputRef.current?.focus();
        cashInputRef.current?.select();
      }, 50);
    }
  }, [isOpen, totalTTC]);

  // Focus next sale button once completed
  useEffect(() => {
    if (completedSale) {
      setTimeout(() => {
        startNextSaleBtnRef.current?.focus();
      }, 80);
    }
  }, [completedSale]);

  // Handle hardware / gesture back button
  useEffect(() => {
    if (!isOpen) return;
    return registerBackHandler(() => {
      if (completedSale) {
        onSaleDone?.();
        onClose();
      } else {
        // During active checkout: close modal and preserve cart
        onClose();
      }
      return true;
    });
  }, [isOpen, completedSale, onSaleDone, onClose]);

  // Recalculate validation & change due
  useEffect(() => {
    if (!isOpen || completedSale) return;

    if (scannerError) {
      setValidationError(scannerError);
      setChangeDue(0);
      return;
    }

    const cash = parseFloat(cashPaid) || 0;
    const wallet = parseFloat(walletPaid) || 0;
    const credit = parseFloat(creditAmount) || 0;

    const res = validateSplitPayment(totalTTC, cash, wallet, credit, customer, {
      rawCashString: cashPaid,
      highChangeConfirmed
    });
    if (!res.valid) {
      setValidationError(res.error || 'Invalid payment amounts');
      setChangeDue(res.changeDue || 0);
    } else {
      setValidationError(null);
      setChangeDue(res.changeDue);
    }
  }, [cashPaid, walletPaid, creditAmount, totalTTC, customer, isOpen, completedSale, highChangeConfirmed, scannerError]);

  // Dynamic banknote options for quick cash tender
  const currentWallet = parseFloat(walletPaid) || 0;
  const cashRemaining = Math.max(0, roundMoney(totalTTC - currentWallet));

  const quickCashOptions = useMemo(() => {
    if (cashRemaining <= 0) return [];
    const candidates = new Set<number>();
    const nextFive = Math.ceil(cashRemaining / 5) * 5;
    const nextTen = Math.ceil(cashRemaining / 10) * 10;
    const nextTwenty = Math.ceil(cashRemaining / 20) * 20;
    const nextFifty = Math.ceil(cashRemaining / 50) * 50;

    if (nextFive > cashRemaining) candidates.add(nextFive);
    if (nextTen > cashRemaining) candidates.add(nextTen);
    if (nextTwenty > cashRemaining) candidates.add(nextTwenty);
    if (nextFifty > cashRemaining) candidates.add(nextFifty);

    [10, 20, 50, 100].forEach(d => {
      if (d > cashRemaining) candidates.add(d);
    });

    return Array.from(candidates).sort((a, b) => a - b).slice(0, 3);
  }, [cashRemaining]);

  // Fast-checkout keyboard listener (Enter to complete / start next)
  useEffect(() => {
    if (!isOpen) return;
    const handleModalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (completedSale) {
          e.preventDefault();
          onSaleDone?.();
          onClose();
        } else {
          // Guard: if integer part has > 7 digits, clear input, preventDefault, show error, do not submit
          const intPart = cashPaid.split('.')[0].replace(/^[-+]/, '').replace(/^0+/, '') || '0';
          if (intPart.length > 7) {
            e.preventDefault();
            setCashPaid('');
            setScannerError('Montant espèces invalide - code-barres scanné ?');
            setValidationError('Montant espèces invalide - code-barres scanné ?');
            return;
          }

          // Guard: if cash exceeds maxAllowedCash
          const cash = parseFloat(cashPaid) || 0;
          if (cash > Math.max(100 * totalTTC, 1000)) {
            e.preventDefault();
            setValidationError('Montant espèces invalide - code-barres scanné ?');
            return;
          }

          if (!validationError && !isSubmittingRef.current && (!activeSession || activeSession.status === 'OPEN')) {
            e.preventDefault();
            handleSubmit();
          }
        }
      } else if (e.key === 'Escape' && !isSubmittingRef.current) {
        if (!completedSale) {
          e.preventDefault();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleModalKeyDown);
    return () => window.removeEventListener('keydown', handleModalKeyDown);
  }, [isOpen, completedSale, validationError, activeSession, cashPaid, walletPaid, creditAmount, totalTTC, highChangeConfirmed]);

  if (!isOpen) return null;

  const handleQuickCash = (amount: number) => {
    setCashPaid(amount.toFixed(3));
    setCreditAmount('0.000');
    setHighChangeConfirmed(false);
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
    setHighChangeConfirmed(false);
  };

  const handleApplyCredit = () => {
    if (!customer) return;
    const currentW = parseFloat(walletPaid) || 0;
    const remaining = Math.max(0, roundMoney(totalTTC - currentW));
    setCreditAmount(remaining.toFixed(3));
    setCashPaid('0.000');
    setHighChangeConfirmed(false);
  };

  const handleSubmit = async () => {
    if (isSubmittingRef.current) return;
    const intPart = cashPaid.split('.')[0].replace(/^[-+]/, '').replace(/^0+/, '') || '0';
    if (intPart.length > 7) {
      setCashPaid('');
      setScannerError('Montant espèces invalide - code-barres scanné ?');
      setValidationError('Montant espèces invalide - code-barres scanné ?');
      return;
    }

    const cash = parseFloat(cashPaid) || 0;
    if (cash > Math.max(100 * totalTTC, 1000)) {
      setValidationError('Montant espèces invalide - code-barres scanné ?');
      return;
    }

    const wallet = parseFloat(walletPaid) || 0;
    const credit = parseFloat(creditAmount) || 0;

    const res = validateSplitPayment(totalTTC, cash, wallet, credit, customer, {
      rawCashString: cashPaid,
      highChangeConfirmed
    });
    if (!res.valid) {
      setValidationError(res.error || 'Validation failed');
      return;
    }

    if (activeSession !== undefined && (!activeSession || activeSession.status !== 'OPEN')) {
      setValidationError('La caisse est fermée. Une session de caisse ouverte est obligatoire pour finaliser la vente.');
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const payload = buildPaymentPayload(totalTTC, cash, wallet, credit);
      const result = await onCompleteSale({
        ...payload,
        total_discount: saleDiscount || 0
      });
      if (result) {
        setCompletedSale(result);
      }
    } catch (err: any) {
      setValidationError(err.message || 'Error processing checkout');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handlePrint58mm = async () => {
    if (!completedSale) return;
    setIsPrintingDirect(true);
    setPrintSuccessMessage(null);

    try {
      const targetId = completedSale.sale_id || completedSale.receipt_number;
      const tender = buildPaymentPayload(totals.totalTTC, parseFloat(cashPaid) || 0, parseFloat(walletPaid) || 0, parseFloat(creditAmount) || 0);
      const salePayload: any = {
        id: targetId,
        receipt_number: completedSale.receipt_number,
        date: new Date().toISOString(),
        customer_name: customer?.name || 'Client Passager',
        subtotal_ht: totals.subtotalHT,
        tva_amount: totals.tvaAmount,
        total_ttc: totals.totalTTC,
        total_discount: saleDiscount || 0,
        cash_paid: tender.cash_paid,
        cash_tendered: tender.cash_tendered,
        wallet_paid: parseFloat(walletPaid) || 0,
        credit_amount: parseFloat(creditAmount) || 0,
        change_given: changeDue || 0,
        items: items.map(item => ({
          catalog_product_name: item.name,
          name: item.name,
          description: item.name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          pack_multiplier: item.pack_multiplier || 1,
          discount_amount: item.discount_amount || 0,
          line_total: Math.max(0, (item.unit_price * item.quantity) - (item.discount_amount || 0))
        }))
      };

      // 1. Direct WebUSB
      if (webUsbPrinter.getStatus().isConnected) {
        await webUsbPrinter.printReceipt(salePayload);
        setPrintSuccessMessage('Ticket imprimé via WebUSB !');
        setTimeout(() => setPrintSuccessMessage(null), 3500);
        return;
      }

      // 2. Direct Bluetooth Classic (SPP) on Android (MPT-II)
      if (nativeSppPrinter.isSupported()) {
        try {
          await nativeSppPrinter.printReceipt(salePayload);
          setPrintSuccessMessage('Ticket imprimé via Bluetooth SPP !');
          setTimeout(() => setPrintSuccessMessage(null), 3500);
          return;
        } catch (sppErr: any) {
          console.warn('[SPP] Bluetooth print attempt failed:', sppErr);
          setPrintSuccessMessage(`Ticket enregistré (impression: ${sppErr?.message || 'non disponible'})`);
          setTimeout(() => setPrintSuccessMessage(null), 4000);
          return;
        }
      }

      // 3. Direct WebBluetooth on mobile
      if (webBluetoothPrinter.getStatus().isConnected) {
        await webBluetoothPrinter.printReceipt(salePayload);
        setPrintSuccessMessage('Ticket imprimé via Bluetooth !');
        setTimeout(() => setPrintSuccessMessage(null), 3500);
        return;
      }

      // 4. Attempt backend POS hardware print
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
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col border border-slate-200 my-auto max-h-[95dvh]">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold">
              {completedSale ? 'Vente finalisée' : 'Encaisser'}
            </h2>
            <p className="text-xs text-slate-400">
              {customer ? `${customer.name} (${customer.type})` : 'Client Passager'}
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
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {completedSale ? (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle className="w-10 h-10" />
              </div>
              <h3 className="text-xl font-bold text-slate-800">
                Transaction réussie !
              </h3>
              <p className="text-sm font-semibold text-slate-500">
                N° Reçu : <span className="text-slate-900 font-mono">{completedSale.receipt_number}</span>
              </p>
              {changeDue > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 inline-block">
                  <span className="text-xs font-semibold text-emerald-800 uppercase block">Monnaie rendue</span>
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
                      ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                      : 'bg-slate-800 hover:bg-slate-900 text-white'
                  }`}
                >
                  <Printer className={`w-4 h-4 ${isPrintingDirect ? 'animate-spin' : ''}`} />
                  {isPrintingDirect ? 'Impression...' : printSuccessMessage ? 'Imprimé !' : 'Imprimer ticket 58mm'}
                </button>
                <button
                  type="button"
                  onClick={() => onPrintInvoice(completedSale.sale_id)}
                  className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded-xl shadow transition-colors"
                >
                  <FileText className="w-4 h-4" />
                  Imprimer facture A4
                </button>
                {onPrintDeliveryNote && (
                  <button
                    type="button"
                    onClick={() => onPrintDeliveryNote(completedSale.sale_id)}
                    className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2.5 px-4 rounded-xl shadow transition-colors"
                  >
                    <Truck className="w-4 h-4" />
                    Bon de Livraison (BL)
                  </button>
                )}
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
                  ref={startNextSaleBtnRef}
                  onClick={() => {
                    onSaleDone?.();
                    onClose();
                  }}
                  className="text-slate-600 hover:text-slate-900 font-semibold text-sm underline focus:ring-2 focus:ring-emerald-500 rounded px-2 py-1"
                >
                  Nouvelle vente (Entrée)
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Total Due Banner */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Total à payer (TTC)
                  </span>
                  <div className="text-4xl font-black text-slate-900 tracking-tight font-mono">
                    {formatMoney(totalTTC)}
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>Total HT : {formatMoney(totals.subtotalHT)}</div>
                  <div>TVA (19%) : {formatMoney(totals.tvaAmount)}</div>
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
                <label className="text-pos-caption font-bold text-slate-700 mb-1.5 block">
                  Espèces rapides
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
                    className="py-2.5 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg text-sm font-bold border border-emerald-200 transition-colors shadow-xs min-h-[44px]"
                  >
                    Exact {(parseFloat(walletPaid) || 0) > 0 ? `(${formatMoney(Math.max(0, roundMoney(totalTTC - (parseFloat(walletPaid) || 0))))})` : ''}
                  </button>
                  {quickCashOptions.map(amount => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => handleQuickCash(amount)}
                      className="py-2.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-sm font-bold border border-slate-200 transition-colors min-h-[44px]"
                    >
                      {amount} DT
                    </button>
                  ))}
                </div>
              </div>

              {/* Split Tender Inputs */}
              <div className="space-y-3">
                {/* Cash Tender */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Banknote className="w-4 h-4 text-emerald-600" />
                      Espèces reçues (DT) — Entrée pour valider
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
                        Payer le reste ({formatMoney(Math.max(0, roundMoney(totalTTC - (parseFloat(walletPaid) || 0))))})
                      </button>
                    )}
                  </div>
                  <input
                    ref={cashInputRef}
                    type="number"
                    step="0.001"
                    min="0"
                    value={cashPaid}
                    onFocus={e => e.target.select()}
                    onChange={e => {
                      setCashPaid(e.target.value);
                      setHighChangeConfirmed(false);
                      if (scannerError) setScannerError(null);
                    }}
                    className="w-full text-pos-input font-bold font-mono px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    placeholder="0.000"
                  />
                </div>

                {/* Customer Wallet */}
                {customer && (
                  <div className="bg-purple-50/60 border border-purple-200/80 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-purple-900 flex items-center gap-1.5">
                        <Wallet className="w-4 h-4 text-purple-600" />
                        Paiement par solde (Solde : {formatMoney(customer.wallet_balance)})
                      </span>
                      {customer.wallet_balance > 0 && (
                        <button
                          type="button"
                          onClick={handleApplyMaxWallet}
                          className="text-[11px] font-bold text-purple-700 bg-purple-100 hover:bg-purple-200 px-2 py-0.5 rounded transition-colors"
                        >
                          Max
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
                        Crédit client (DT)
                      </span>
                      <button
                        type="button"
                        onClick={handleApplyCredit}
                        className="text-[11px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded transition-colors"
                      >
                        {(parseFloat(walletPaid) || 0) > 0
                          ? `Reporter reste (${formatMoney(Math.max(0, roundMoney(totalTTC - (parseFloat(walletPaid) || 0))))})`
                          : 'Tout à crédit'}
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
                  Monnaie à rendre :
                </span>
                <span className="text-2xl font-black text-emerald-700 font-mono">
                  {formatMoney(changeDue)}
                </span>
              </div>

              {/* High Change Due Confirmation */}
              {changeDue > 500 && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-pos-caption text-amber-900 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                    <span>
                      <strong>Rendu de monnaie élevé ({formatMoney(changeDue)} &gt; 500 DT)</strong> : veuillez confirmer ce montant.
                    </span>
                  </div>
                  <label className="flex items-center gap-1.5 font-bold cursor-pointer bg-white px-2.5 py-1.5 rounded-lg border border-amber-300 shadow-xs shrink-0 select-none hover:bg-amber-100/50">
                    <input
                      type="checkbox"
                      checked={highChangeConfirmed}
                      onChange={e => setHighChangeConfirmed(e.target.checked)}
                      className="w-4 h-4 text-amber-600 rounded"
                    />
                    <span>Confirmer</span>
                  </label>
                </div>
              )}

              {/* Validation Error */}
              {validationError && (
                <div className="flex items-center gap-2 text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2 rounded-xl text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{validationError}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sticky Footer for Active Checkout */}
        {!completedSale && (
          <div className="sticky bottom-0 z-10 bg-white border-t border-slate-200 p-4 flex gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={Boolean(validationError) || isSubmitting || (activeSession !== undefined && (!activeSession || activeSession.status !== 'OPEN'))}
              onClick={handleSubmit}
              className="flex-[2] py-3.5 min-h-[52px] bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 text-white font-extrabold rounded-xl shadow-lg transition-all text-lg flex items-center justify-center gap-2"
            >
              {isSubmitting
                ? 'Traitement...'
                : activeSession !== undefined && (!activeSession || activeSession.status !== 'OPEN')
                ? 'Caisse fermée'
                : 'Valider et ouvrir le tiroir'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
