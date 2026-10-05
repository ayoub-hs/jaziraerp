import React, { useState, useEffect } from 'react';
import { X, Receipt, AlertCircle } from 'lucide-react';

interface CreateExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  activeSessionId?: string | null;
}

const COMMON_EXPENSE_CATEGORIES = [
  'Loyer (Rent)',
  'Électricité & Eau (Utilities)',
  'Carburant (Fuel)',
  'Transport & Livraison',
  'Fournitures Magasin & Bureau',
  'Maintenance & Réparation',
  'Salaires & Main-d’œuvre',
  'Frais Bancaires',
  'Autre Dépense'
];

export const CreateExpenseModal: React.FC<CreateExpenseModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  activeSessionId
}) => {
  const [category, setCategory] = useState(COMMON_EXPENSE_CATEGORIES[0]);
  const [customCategory, setCustomCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentSource, setPaymentSource] = useState<'REGISTER_CASH' | 'BANK_OTHER'>('REGISTER_CASH');
  const [description, setDescription] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Open register sessions for REGISTER_CASH (same pattern as RefundModal)
  const [openSessions, setOpenSessions] = useState<any[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/register/open-sessions')
      .then(res => (res.ok ? res.json() : []))
      .then((sessions: any[]) => {
        setOpenSessions(sessions || []);
        setSelectedSessionId(prev => {
          if (prev && sessions.some(s => s.id === prev)) return prev;
          if (activeSessionId && sessions.some(s => s.id === activeSessionId)) return activeSessionId;
          return sessions.length > 0 ? sessions[0].id : '';
        });
      })
      .catch(() => setOpenSessions([]));
  }, [isOpen, activeSessionId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const expenseAmount = parseFloat(amount);
    if (isNaN(expenseAmount) || expenseAmount <= 0) {
      setError('Expense amount must be greater than 0');
      return;
    }

    const finalCategory = category === 'Autre Dépense' && customCategory.trim()
      ? customCategory.trim()
      : category;

    const sessionId = paymentSource === 'REGISTER_CASH' ? selectedSessionId || null : null;
    if (paymentSource === 'REGISTER_CASH' && !sessionId) {
      setError('Aucune session de caisse ouverte. Ouvrez une caisse pour payer depuis le tiroir.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/accounting/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: finalCategory,
          amount: expenseAmount,
          payment_source: paymentSource,
          session_id: sessionId,
          description: description.trim() || null
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to record expense');
      }

      setAmount('');
      setDescription('');
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error recording expense');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
              <Receipt className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">Record General Expense</h3>
              <p className="text-[11px] text-slate-500">Log operational cash outlays and shop expenses</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block font-bold text-slate-700 mb-1">Expense Category *</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none"
            >
              {COMMON_EXPENSE_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {category === 'Autre Dépense' && (
            <div>
              <label className="block font-bold text-slate-700 mb-1">Custom Category Name *</label>
              <input
                type="text"
                required
                placeholder="Enter custom category"
                value={customCategory}
                onChange={e => setCustomCategory(e.target.value)}
                className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Amount (DT) *</label>
              <input
                type="number"
                step="0.001"
                min="0.001"
                required
                placeholder="0.000"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none text-rose-700 text-sm"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Payment Source *</label>
              <select
                value={paymentSource}
                onChange={e => setPaymentSource(e.target.value as any)}
                className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none"
              >
                <option value="REGISTER_CASH">Caisse Magasin (Register Drawer)</option>
                <option value="BANK_OTHER">Banque / Autre Compte</option>
              </select>
            </div>
          </div>

          {paymentSource === 'REGISTER_CASH' && (
            openSessions.length === 0 ? (
              <div className="p-2.5 bg-rose-50 rounded-xl border border-rose-200 text-rose-800 text-[11px] leading-relaxed flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>La caisse est fermée. Une session de caisse ouverte est obligatoire pour payer depuis le tiroir.</span>
              </div>
            ) : openSessions.length === 1 ? (
              <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 text-[11px] leading-relaxed">
                <strong>Notice:</strong> Paying from the register drawer will automatically record a{' '}
                <span className="font-mono font-bold">CASH_OUT</span> movement linked to session{' '}
                <span className="font-mono font-bold">{openSessions[0].counter_name} ({openSessions[0].session_number})</span>.
              </div>
            ) : (
              <div>
                <label className="block font-bold text-slate-700 mb-1">Caisse débitée (session ouverte) *</label>
                <select
                  value={selectedSessionId}
                  onChange={e => setSelectedSessionId(e.target.value)}
                  className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none bg-white"
                >
                  {openSessions.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.counter_name} — Session {s.session_number}
                    </option>
                  ))}
                </select>
              </div>
            )
          )}

          <div>
            <label className="block font-bold text-slate-700 mb-1">Description / Memo (Optional)</label>
            <input
              type="text"
              placeholder="e.g. Café atelier, Facture STEG mars, Bouteilles gaz..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500 outline-none"
            />
          </div>

          {/* Footer */}
          <div className="flex gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5"
            >
              <Receipt className="w-4 h-4" />
              <span>{isSubmitting ? 'Recording...' : 'Save Expense'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
