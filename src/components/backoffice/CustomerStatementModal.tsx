import React, { useState, useEffect } from 'react';
import { X, FileText, Download, RefreshCw, AlertCircle, Calendar, ArrowUpRight, ArrowDownLeft, Wallet, CreditCard } from 'lucide-react';
import type { Customer } from '../../types/index.js';
import { formatMoney, formatDateTime, formatDate } from '../../utils/formatters.js';
import { exportToCsv } from '../../utils/csv.js';

interface StatementEntry {
  id: string;
  entry_type: 'TICKET' | 'PAYMENT' | 'WALLET';
  reference: string;
  date: string;
  debit: number;
  credit: number;
  status?: string | null;
  created_at: string;
  running_balance?: number;
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
  const [entries, setEntries] = useState<StatementEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && customer) {
      loadStatement();
    } else {
      setEntries([]);
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

      const rawEntries: StatementEntry[] = await res.json();

      // Sort chronological (oldest to newest) to compute running balance
      const chronological = [...rawEntries].sort((a, b) => {
        const timeA = new Date(a.date || a.created_at).getTime();
        const timeB = new Date(b.date || b.created_at).getTime();
        if (timeA !== timeB) return timeA - timeB;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      let balance = 0;
      const computed = chronological.map(item => {
        balance = Math.round(((balance + (item.debit || 0) - (item.credit || 0)) + Number.EPSILON) * 1000) / 1000;
        return {
          ...item,
          running_balance: balance
        };
      });

      // Display newest first
      setEntries(computed.reverse());
    } catch (err: any) {
      setError(err.message || 'Impossible de récupérer le relevé');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCsv = () => {
    if (!customer || entries.length === 0) return;

    const headers = [
      'Date',
      'Type',
      'Reference',
      'Debit (DT)',
      'Credit (DT)',
      'Solde Progressif (DT)',
      'Statut / Notes'
    ];

    const rows = entries.map(e => [
      formatDate(e.date),
      e.entry_type === 'TICKET' ? 'Billet de dette' : e.entry_type === 'PAYMENT' ? 'Paiement dette' : 'Portefeuille',
      e.reference || '',
      e.debit ? Number(e.debit).toFixed(3) : '0.000',
      e.credit ? Number(e.credit).toFixed(3) : '0.000',
      e.running_balance !== undefined ? Number(e.running_balance).toFixed(3) : '0.000',
      e.status || ''
    ]);

    const sanitizedName = (customer.name || 'client').replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    exportToCsv(`releve_${sanitizedName}_${dateStr}.csv`, headers, rows);
  };

  if (!isOpen || !customer) return null;

  const totalDebits = entries.reduce((sum, e) => sum + (e.debit || 0), 0);
  const totalCredits = entries.reduce((sum, e) => sum + (e.credit || 0), 0);

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full flex flex-col border border-slate-200 max-h-[90vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-400/40 flex items-center justify-center text-blue-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black">Relevé de Compte Client / Customer Statement</h2>
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
              onClick={handleExportCsv}
              disabled={isLoading || entries.length === 0}
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

        {/* Customer Balance Summary Bar */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
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
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Total Débits</span>
            <span className="text-sm font-black font-mono text-slate-800">
              {formatMoney(totalDebits)}
            </span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Total Crédits</span>
            <span className="text-sm font-black font-mono text-emerald-700">
              {formatMoney(totalCredits)}
            </span>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
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
          ) : entries.length === 0 ? (
            <div className="py-16 text-center bg-slate-50 rounded-2xl border border-slate-200 border-dashed">
              <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-600">Aucun mouvement enregistré</p>
              <p className="text-xs text-slate-400 mt-1">Ce client n'a pas encore de billets de dette, de paiements ou d'opérations de portefeuille.</p>
            </div>
          ) : (
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
                      const isWallet = entry.entry_type === 'WALLET';

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
                            {isWallet && (
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
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>{entries.length} écriture(s) dans le grand livre</span>
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
