import React, { useState } from 'react';
import { X, ArrowDownRight, ArrowUpRight, AlertCircle, Check } from 'lucide-react';
import type { RegisterSession } from '../../types/index.js';
import { syncManager } from '../../services/syncManager.js';

interface CashMovementModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeSession: RegisterSession | null;
  onSuccess: () => void;
}

export const CashMovementModal: React.FC<CashMovementModalProps> = ({
  isOpen,
  onClose,
  activeSession,
  onSuccess
}) => {
  const [type, setType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_OUT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession) {
      setError('No active register session found');
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Amount must be greater than 0 DT');
      return;
    }
    if (!reason.trim()) {
      setError('Reason / description is required');
      return;
    }

    setSubmitting(true);
    setError(null);

    const movementPayload = {
      session_id: activeSession.id,
      type,
      amount: parsedAmount,
      reason: reason.trim(),
      date: new Date().toISOString()
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      try {
        await syncManager.queueOfflineAction('CASH_MOVEMENT', movementPayload);
        onSuccess();
        onClose();
        return;
      } catch (err: any) {
        setError(err.message || 'Error queueing offline cash movement');
        setSubmitting(false);
        return;
      }
    }

    try {
      const res = await fetch('/api/register/movement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(movementPayload)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to record cash movement');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      if (err.name === 'TypeError' || err.message?.includes('fetch')) {
        try {
          await syncManager.queueOfflineAction('CASH_MOVEMENT', movementPayload);
          onSuccess();
          onClose();
          return;
        } catch (queueErr: any) {
          setError(queueErr.message || 'Failed to queue offline cash movement');
          return;
        }
      }
      setError(err.message || 'Error executing cash movement');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <h2 className="text-base font-bold">Register Cash Movement</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Movement Type Tabs */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setType('CASH_OUT')}
              className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                type === 'CASH_OUT'
                  ? 'bg-white text-rose-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ArrowUpRight className="w-4 h-4" />
              Cash Out (Expense/Payout)
            </button>
            <button
              type="button"
              onClick={() => setType('CASH_IN')}
              className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                type === 'CASH_IN'
                  ? 'bg-white text-emerald-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ArrowDownRight className="w-4 h-4" />
              Cash In (Float Top-up)
            </button>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Amount (DT) *
            </label>
            <input
              type="number"
              step="0.001"
              min="0.001"
              required
              autoFocus
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="10.000"
              className="w-full text-lg font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Reason / Expense Note *
            </label>
            <input
              type="text"
              required
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={type === 'CASH_OUT' ? 'e.g. Purchased coffee/cleaning supplies' : 'e.g. Added 50 DT change float'}
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
              disabled={submitting}
              className={`flex-1 py-2.5 text-white font-bold rounded-xl text-sm shadow transition-colors ${
                type === 'CASH_OUT'
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {submitting ? 'Saving...' : `Record ${type === 'CASH_OUT' ? 'Cash Out' : 'Cash In'}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
