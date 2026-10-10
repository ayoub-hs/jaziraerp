import React, { useState, useEffect } from 'react';
import { X, FileText, Download, RefreshCw, AlertCircle, ArrowUpRight, ArrowDownLeft, Wallet, CreditCard, Printer } from 'lucide-react';
import type { Customer } from '../../types/index.js';
import { formatMoney, formatDateTime, formatDate } from '../../utils/formatters.js';
import { exportToCsv } from '../../utils/csv.js';
import { useBackButton } from '../../utils/backButton.js';
import { useModalScanPause } from '../../hooks/useModalScanPause.js';
import { getShopInfo } from '../../services/shopInfo.js';

export interface StatementEntry {
  id: string;
  entry_type: 'TICKET' | 'PAYMENT' | 'WALLET' | 'REFUND_CREDIT' | string;
  reference: string;
  date: string;
  debit: number;
  credit: number;
  status?: string | null;
  created_at: string;
  running_balance?: number;
}

export interface Ledger {
  entries: StatementEntry[];
  final_balance: number;
}

interface CustomerStatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: Customer | null;
}

export const CustomerStatementModal: React.FC<CustomerStatementModalProps> = ({
  isOpen,
  onClose,
  customer
}) => {
  useModalScanPause(isOpen);

  const [debt, setDebt] = useState<Ledger>({ entries: [], final_balance: 0 });
  const [wallet, setWallet] = useState<Ledger>({ entries: [], final_balance: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shop = getShopInfo();

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  useEffect(() => {
    if (isOpen && customer) {
      loadStatement();
    } else {
      setDebt({ entries: [], final_balance: 0 });
      setWallet({ entries: [], final_balance: 0 });
      setError(null);
    }
  }, [isOpen, customer?.id]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const loadStatement = async () => {
    if (!customer) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/customers/${customer.id}/statement`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erreur lors du chargement du relevé');
      }

      const data = await res.json();

      // Server returns two ledgers, newest-first for display. Running balances
      // are computed server-side (oldest to newest).
      const newestFirst = (entries: StatementEntry[]) => [...entries].reverse();
      setDebt({
        entries: newestFirst(data.debt?.entries || []),
        final_balance: data.debt?.final_balance || 0
      });
      setWallet({
        entries: newestFirst(data.wallet?.entries || []),
        final_balance: data.wallet?.final_balance || 0
      });
    } catch (err: any) {
      setError(err.message || 'Impossible de récupérer le relevé');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportCsv = () => {
    if (!customer || (debt.entries.length === 0 && wallet.entries.length === 0)) return;

    const headers = [
      'Registre',
      'Date',
      'Type',
      'Reference',
      'Debit (DT)',
      'Credit (DT)',
      'Solde Progressif (DT)',
      'Statut / Notes'
    ];

    const toRows = (ledgerName: string, entries: StatementEntry[]) =>
      entries.map(e => {
        let typeLabel = '';
        if (e.entry_type === 'TICKET') typeLabel = 'Billet de dette';
        else if (e.entry_type === 'PAYMENT') typeLabel = 'Paiement dette';
        else if (e.entry_type === 'REFUND_CREDIT') typeLabel = 'Réduction dette (Remboursement)';
        else if (e.entry_type === 'WALLET') typeLabel = `Portefeuille (${e.reference || ''})`;
        else typeLabel = String(e.entry_type);

        return [
          ledgerName,
          formatDate(e.date || e.created_at),
          typeLabel,
          e.reference || '',
          e.debit ? Number(e.debit).toFixed(3) : '0.000',
          e.credit ? Number(e.credit).toFixed(3) : '0.000',
          e.running_balance !== undefined ? Number(e.running_balance).toFixed(3) : '0.000',
          e.status || ''
        ];
      });

    const rows = [
      ...toRows('Dette', debt.entries),
      ...toRows('Portefeuille', wallet.entries)
    ];

    const sanitizedName = (customer.name || 'client')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    exportToCsv(`releve_${sanitizedName}_${dateStr}.csv`, headers, rows);
  };

  if (!isOpen || !customer) return null;

  const totalEntries = debt.entries.length + wallet.entries.length;

  const allDates = [...debt.entries, ...wallet.entries]
    .map(e => e.date || e.created_at)
    .filter(Boolean)
    .sort();
  const periodLabel = allDates.length > 0
    ? `Du ${formatDate(allDates[0])} au ${formatDate(allDates[allDates.length - 1])}`
    : 'Toutes les dates';

  const customerMatricule = (customer as any).matricule_fiscal || (customer as any).matricule || (customer as any).tax_id || '—';

  const renderLedgerTable = (entries: StatementEntry[]) => (
    <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs min-w-[700px]">
          <thead className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-2.5 px-3">Date</th>
              <th className="py-2.5 px-3">Type</th>
              <th className="py-2.5 px-3">Référence</th>
              <th className="py-2.5 px-3 text-right">Débit (+)</th>
              <th className="py-2.5 px-3 text-right">Crédit (-)</th>
              <th className="py-2.5 px-3 text-right">Solde Progressif</th>
              <th className="py-2.5 px-3">Statut / Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((entry) => {
              const isTicket = entry.entry_type === 'TICKET';
              const isPayment = entry.entry_type === 'PAYMENT';
              const isRefundCredit = entry.entry_type === 'REFUND_CREDIT';
              const isWalletEntry = entry.entry_type === 'WALLET';

              return (
                <tr key={entry.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-2.5 px-3 font-medium text-slate-700 whitespace-nowrap">
                    {formatDate(entry.date || entry.created_at)}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {isTicket && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                        <ArrowUpRight className="w-3 h-3 text-amber-600" />
                        Billet Dette
                      </span>
                    )}
                    {isPayment && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                        <ArrowDownLeft className="w-3 h-3 text-emerald-600" />
                        Paiement
                      </span>
                    )}
                    {isRefundCredit && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
                        <RefreshCw className="w-3 h-3 text-blue-600" />
                        Remboursement
                      </span>
                    )}
                    {isWalletEntry && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-800 border border-purple-200">
                        <Wallet className="w-3 h-3 text-purple-600" />
                        Portefeuille
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 font-mono font-semibold text-slate-800">
                    {entry.reference}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-700">
                    {entry.debit > 0 ? formatMoney(entry.debit) : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
                    {entry.credit > 0 ? formatMoney(entry.credit) : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 bg-slate-50/40">
                    {entry.running_balance !== undefined ? formatMoney(entry.running_balance) : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-slate-500 max-w-xs truncate text-[11px]">
                    {entry.status || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200 print:p-0 print:bg-white print:static print:overflow-visible print:block"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full flex flex-col border border-slate-200 max-h-[90vh] overflow-hidden print:border-none print:shadow-none print:w-full print:max-w-none print:max-h-none print:overflow-visible"
        onClick={e => e.stopPropagation()}
      >
        {/* Header - Screen only */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0 print:hidden">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-400/40 flex items-center justify-center text-blue-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black">Relevé de Compte Client</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-400/30">
                  {customer.type}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {customer.name} {customer.phone ? `• ${customer.phone}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold transition-colors shadow-sm cursor-pointer disabled:cursor-not-allowed"
              title="Imprimer ou exporter en PDF (A4)"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimer / PDF</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={isLoading || totalEntries === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-bold border border-slate-700 transition-colors shadow-sm cursor-pointer disabled:cursor-not-allowed"
              title="Exporter au format CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exporter CSV</span>
            </button>
            <button
              type="button"
              onClick={loadStatement}
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

        {/* Customer Balance Summary Bar - Screen only */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0 print:hidden">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Dette Ouverte</span>
            <span className="text-sm font-black font-mono text-amber-700">
              {formatMoney(customer.total_debt)}
            </span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Portefeuille (Avoir)</span>
            <span className="text-sm font-black font-mono text-purple-700">
              {formatMoney(customer.wallet_balance)}
            </span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Solde Registre Dette</span>
            <span className="text-sm font-black font-mono text-slate-800">
              {formatMoney(debt.final_balance)}
            </span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Solde Registre Portefeuille</span>
            <span className="text-sm font-black font-mono text-emerald-700">
              {formatMoney(wallet.final_balance)}
            </span>
          </div>
        </div>

        {/* Content Area - Screen only */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 print:hidden">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-800 text-xs font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {isLoading ? (
            <div className="py-16 text-center">
              <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-500">Chargement de l'historique du grand livre...</p>
            </div>
          ) : totalEntries === 0 ? (
            <div className="py-16 text-center bg-slate-50 rounded-2xl border border-slate-200 border-dashed">
              <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-600">Aucun mouvement enregistré</p>
              <p className="text-xs text-slate-400 mt-1">Ce client n'a pas encore de billets de dette, de paiements ou d'opérations de portefeuille.</p>
            </div>
          ) : (
            <>
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-amber-600" />
                  Registre Dette — solde {formatMoney(debt.final_balance)}
                </h3>
                {debt.entries.length === 0 ? (
                  <p className="text-xs text-slate-400">Aucune écriture de dette.</p>
                ) : renderLedgerTable(debt.entries)}
              </div>
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Wallet className="w-4 h-4 text-purple-600" />
                  Registre Portefeuille — solde {formatMoney(wallet.final_balance)}
                </h3>
                {wallet.entries.length === 0 ? (
                  <p className="text-xs text-slate-400">Aucune opération de portefeuille.</p>
                ) : renderLedgerTable(wallet.entries)}
              </div>
            </>
          )}
        </div>

        {/* Footer - Screen only */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 flex items-center justify-between text-xs text-slate-500 shrink-0 print:hidden">
          <span>{totalEntries} écriture(s) dans le grand livre</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-200 shadow-2xs transition-colors"
          >
            Fermer
          </button>
        </div>

        {/* Dedicated A4 Print Layout - Visible ONLY in Print */}
        <div className="hidden print:block print:w-full print:p-8 text-slate-900 text-xs font-sans">
          {/* Shop Header */}
          <div className="flex justify-between items-start border-b-2 border-slate-900 pb-4 mb-4">
            <div>
              <h1 className="text-lg font-black tracking-tight uppercase">{shop.shop_name}</h1>
              {shop.shop_subtitle ? <p className="text-xs text-slate-600">{shop.shop_subtitle}</p> : null}
              <div className="text-[11px] text-slate-600 mt-1 space-y-0.5">
                {shop.shop_address ? <div>{shop.shop_address}</div> : null}
                {shop.shop_phone ? <div>Tél: {shop.shop_phone}</div> : null}
                {shop.tax_id ? <div>Matricule Fiscal: <span className="font-semibold">{shop.tax_id}</span></div> : null}
              </div>
            </div>
            <div className="text-right">
              <div className="inline-block bg-slate-900 text-white font-bold px-3 py-1 rounded text-xs mb-1">
                RELEVÉ DE COMPTE CLIENT
              </div>
              <div className="text-[11px] text-slate-700 space-y-0.5 font-mono">
                <div>Date d'édition: <span className="font-semibold">{formatDateTime(new Date().toISOString())}</span></div>
                <div>Période: <span className="font-semibold">{periodLabel}</span></div>
              </div>
            </div>
          </div>

          {/* Customer Details Box */}
          <div className="grid grid-cols-2 gap-4 border border-slate-300 rounded-lg p-3 mb-4 bg-slate-50">
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase block">Client:</span>
              <span className="text-sm font-black text-slate-900">{customer.name}</span>
              <div className="text-[11px] text-slate-600 mt-0.5">
                Catégorie: <span className="font-semibold">{customer.type === 'RESELLER' ? 'Revendeur' : customer.type === 'WHOLESALE' ? 'Grossiste' : 'Détail'}</span>
              </div>
              {customer.phone ? <div className="text-[11px] text-slate-600">Tél: {customer.phone}</div> : null}
              {customer.address ? <div className="text-[11px] text-slate-600">Adresse: {customer.address}</div> : null}
            </div>
            <div className="text-right space-y-1">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase block">Matricule / Identifiant:</span>
                <span className="font-mono font-semibold text-xs text-slate-800">{customerMatricule}</span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between text-xs">
                <span className="font-bold text-slate-700">Solde Dette Actuelle:</span>
                <span className="font-mono font-black text-amber-800">{formatMoney(debt.final_balance)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="font-bold text-slate-700">Solde Portefeuille (Avoir):</span>
                <span className="font-mono font-black text-purple-800">{formatMoney(wallet.final_balance)}</span>
              </div>
            </div>
          </div>

          {/* Debt Ledger Table */}
          <div className="mb-6">
            <div className="border-b border-slate-400 pb-1 mb-2 flex justify-between items-center">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Grand Livre des Dettes
              </h3>
              <span className="text-xs font-mono font-bold text-amber-800">
                Solde dû: {formatMoney(debt.final_balance)}
              </span>
            </div>
            {debt.entries.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic py-1">Aucune écriture de dette enregistrée.</p>
            ) : (
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-slate-300 font-bold uppercase text-[10px] text-slate-600">
                    <th className="py-1 px-1.5">Date</th>
                    <th className="py-1 px-1.5">Type</th>
                    <th className="py-1 px-1.5">Référence</th>
                    <th className="py-1 px-1.5 text-right">Débit (+)</th>
                    <th className="py-1 px-1.5 text-right">Crédit (-)</th>
                    <th className="py-1 px-1.5 text-right">Solde progressif</th>
                    <th className="py-1 px-1.5">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {debt.entries.map(e => (
                    <tr key={e.id}>
                      <td className="py-1 px-1.5 whitespace-nowrap">{formatDate(e.date || e.created_at)}</td>
                      <td className="py-1 px-1.5 whitespace-nowrap font-medium">
                        {e.entry_type === 'TICKET' ? 'Billet dette' : e.entry_type === 'PAYMENT' ? 'Paiement dette' : e.entry_type === 'REFUND_CREDIT' ? 'Remboursement' : e.entry_type}
                      </td>
                      <td className="py-1 px-1.5 font-mono">{e.reference}</td>
                      <td className="py-1 px-1.5 text-right font-mono font-bold text-slate-900">{e.debit > 0 ? formatMoney(e.debit) : '—'}</td>
                      <td className="py-1 px-1.5 text-right font-mono font-bold text-slate-900">{e.credit > 0 ? formatMoney(e.credit) : '—'}</td>
                      <td className="py-1 px-1.5 text-right font-mono font-black">{e.running_balance !== undefined ? formatMoney(e.running_balance) : '—'}</td>
                      <td className="py-1 px-1.5 text-slate-600 truncate max-w-xs">{e.status || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Wallet Ledger Table */}
          <div className="mb-6">
            <div className="border-b border-slate-400 pb-1 mb-2 flex justify-between items-center">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Grand Livre du Portefeuille (Avoirs)
              </h3>
              <span className="text-xs font-mono font-bold text-emerald-800">
                Solde disponible: {formatMoney(wallet.final_balance)}
              </span>
            </div>
            {wallet.entries.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic py-1">Aucune opération de portefeuille enregistrée.</p>
            ) : (
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-slate-300 font-bold uppercase text-[10px] text-slate-600">
                    <th className="py-1 px-1.5">Date</th>
                    <th className="py-1 px-1.5">Opération</th>
                    <th className="py-1 px-1.5 text-right">Crédit / In (+)</th>
                    <th className="py-1 px-1.5 text-right">Débit / Out (-)</th>
                    <th className="py-1 px-1.5 text-right">Solde progressif</th>
                    <th className="py-1 px-1.5">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {wallet.entries.map(e => (
                    <tr key={e.id}>
                      <td className="py-1 px-1.5 whitespace-nowrap">{formatDate(e.date || e.created_at)}</td>
                      <td className="py-1 px-1.5 font-mono">{e.reference}</td>
                      <td className="py-1 px-1.5 text-right font-mono font-bold text-slate-900">{e.credit > 0 ? formatMoney(e.credit) : '—'}</td>
                      <td className="py-1 px-1.5 text-right font-mono font-bold text-slate-900">{e.debit > 0 ? formatMoney(e.debit) : '—'}</td>
                      <td className="py-1 px-1.5 text-right font-mono font-black">{e.running_balance !== undefined ? formatMoney(e.running_balance) : '—'}</td>
                      <td className="py-1 px-1.5 text-slate-600 truncate max-w-xs">{e.status || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Signature Box */}
          <div className="pt-4 border-t border-slate-300 flex justify-between items-end">
            <div className="text-[10px] text-slate-500 italic">
              Document généré par JaziraERP • Arrêté à un solde de dette de {formatMoney(debt.final_balance)}
            </div>
            <div className="w-56 border border-dashed border-slate-400 rounded-lg p-3 text-center h-24 flex flex-col justify-between">
              <span className="text-[10px] font-bold text-slate-600 uppercase">
                Cachet et Signature Société
              </span>
              <span className="text-[9px] text-slate-400 italic">Pour Al Jazira SHSP</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
