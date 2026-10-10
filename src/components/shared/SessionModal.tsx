import React, { useState, useEffect, useRef } from 'react';
import { X, Lock, Unlock, AlertTriangle, CheckCircle } from 'lucide-react';
import type { RegisterSession } from '../../types/index.js';
import { formatMoney, roundMoney } from '../../utils/formatters.js';
import { useBackButton } from '../../utils/backButton.js';
import { useModalScanPause } from '../../hooks/useModalScanPause.js';

interface SessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'OPEN' | 'CLOSE';
  activeSession: RegisterSession | null;
  onSessionUpdated: () => void;
  currentView?: string;
  onSelectSession?: (session: RegisterSession) => void;
}

export const SessionModal: React.FC<SessionModalProps> = ({
  isOpen,
  onClose,
  mode,
  activeSession,
  onSessionUpdated,
  currentView,
  onSelectSession
}) => {
  useModalScanPause(isOpen);

  const [counterName, setCounterName] = useState('Countertop');
  const [counters, setCounters] = useState<{ id: string; name: string }[]>([]);
  const [isAddingCounter, setIsAddingCounter] = useState(false);
  const [newCounterName, setNewCounterName] = useState('');
  const [openingCash, setOpeningCash] = useState('100.000');
  const [closingCountedCash, setClosingCountedCash] = useState('');
  const [notes, setNotes] = useState('');
  const [expectedCash, setExpectedCash] = useState<number | null>(null);
  const [variance, setVariance] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isSavingCounter, setIsSavingCounter] = useState(false);
  const isSavingCounterRef = useRef(false);

  // Multi-session tracking for register switching and target closing
  const [openSessions, setOpenSessions] = useState<RegisterSession[]>([]);
  const [selectedSessionToCloseId, setSelectedSessionToCloseId] = useState<string>('');

  useBackButton(() => {
    onClose();
    return true;
  }, isOpen);

  const loadSessionDetails = (sessionId: string) => {
    fetch(`/api/register/sessions/${sessionId}`)
      .then(res => res.json())
      .then(data => {
        const exp = data.expected_cash ?? data.opening_cash ?? 0;
        setExpectedCash(exp);
        setClosingCountedCash(exp.toFixed(3));
        setVariance(0);
      })
      .catch(() => {
        const sess = openSessions.find(s => s.id === sessionId) || activeSession;
        if (sess) {
          setExpectedCash(sess.opening_cash);
          setClosingCountedCash(sess.opening_cash.toFixed(3));
        }
      });
  };

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSubmitting(false);
      setIsAddingCounter(false);
      setNewCounterName('');

      // Load registered counters
      fetch('/api/register/counters')
        .then(res => res.json())
        .then((data: any[]) => {
          if (Array.isArray(data) && data.length > 0) {
            setCounters(data);
            if (mode === 'OPEN') {
              const defaultCounter = currentView === 'MOBILE_REGISTER' ? 'Mobile Register' : 'Countertop';
              const exists = data.some(c => c.name === defaultCounter);
              if (exists) {
                setCounterName(defaultCounter);
              } else if (data[0]) {
                setCounterName(data[0].name);
              }
            }
          }
        })
        .catch(err => console.warn('Could not fetch counters:', err));

      if (mode === 'OPEN') {
        const defaultCounter = currentView === 'MOBILE_REGISTER' ? 'Mobile Register' : 'Countertop';
        setCounterName(defaultCounter);
        setOpeningCash(defaultCounter === 'Mobile Register' ? '0.000' : '100.000');
      }

      // Always load all open sessions to provide full visibility and selection
      fetch('/api/register/open-sessions')
        .then(res => res.json())
        .then((sessions: RegisterSession[]) => {
          if (Array.isArray(sessions)) {
            setOpenSessions(sessions);
            if (mode === 'CLOSE') {
              const initialTarget = (activeSession && sessions.some(s => s.id === activeSession.id))
                ? activeSession.id
                : (sessions[0]?.id || '');
              setSelectedSessionToCloseId(initialTarget);
              if (initialTarget) {
                loadSessionDetails(initialTarget);
              }
            }
          }
        })
        .catch(err => console.warn('Could not fetch open sessions list:', err));

      if (mode === 'CLOSE' && activeSession) {
        setSelectedSessionToCloseId(activeSession.id);
        loadSessionDetails(activeSession.id);
      }
    }
  }, [isOpen, mode, activeSession, currentView]);

  useEffect(() => {
    if (mode === 'CLOSE' && selectedSessionToCloseId) {
      loadSessionDetails(selectedSessionToCloseId);
    }
  }, [selectedSessionToCloseId]);

  useEffect(() => {
    if (mode === 'CLOSE' && expectedCash !== null) {
      const counted = parseFloat(closingCountedCash) || 0;
      setVariance(roundMoney(counted - expectedCash));
    }
  }, [closingCountedCash, expectedCash, mode]);

  if (!isOpen) return null;

  const handleOpenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const floatVal = parseFloat(openingCash);
    if (isNaN(floatVal) || floatVal < 0) {
      setError('Opening cash float must be 0 or more');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/register/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          counter_name: counterName,
          opening_cash: floatVal
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to open register session');
      }

      const newSess = await res.json();
      if (onSelectSession) {
        onSelectSession(newSess);
      }

      onSessionUpdated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error opening session');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetSessionId = selectedSessionToCloseId || activeSession?.id;
    if (!targetSessionId) {
      setError('Veuillez sélectionner une session de caisse à clôturer');
      return;
    }

    const countedVal = parseFloat(closingCountedCash);
    if (isNaN(countedVal) || countedVal < 0) {
      setError('Counted cash must be 0 or more');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/register/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: targetSessionId,
          counted_cash: countedVal,
          closing_cash_counted: countedVal,
          notes: notes.trim()
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to close register session');
      }

      onSessionUpdated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error closing session');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode === 'OPEN' ? (
              <Unlock className="w-5 h-5 text-emerald-400" />
            ) : (
              <Lock className="w-5 h-5 text-rose-400" />
            )}
            <h2 className="text-base font-bold">
              {mode === 'OPEN' ? 'Open Register Session' : 'Close Session & Cash Audit'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {mode === 'OPEN' ? (
          <form onSubmit={handleOpenSubmit} className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Register / Counter Name *
              </label>
              {!isAddingCounter ? (
                <div className="flex gap-2">
                  <select
                    value={counterName}
                    onChange={e => {
                      if (e.target.value === '__NEW__') {
                        setIsAddingCounter(true);
                        setNewCounterName('');
                      } else {
                        setCounterName(e.target.value);
                      }
                    }}
                    className="w-full text-sm font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  >
                    {counters.map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                    {counters.length === 0 && (
                      <>
                        <option value="Countertop">Countertop (Main Station)</option>
                        <option value="Mobile Register">Mobile Register (Phone / PWA)</option>
                      </>
                    )}
                    <option value="__NEW__">+ Add New Register / Counter...</option>
                  </select>
                </div>
              ) : (
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    placeholder="e.g. Counter 2, Drive-thru..."
                    value={newCounterName}
                    onChange={e => setNewCounterName(e.target.value)}
                    className="flex-1 text-xs font-semibold px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    disabled={isSavingCounter}
                    onClick={async () => {
                      if (isSavingCounterRef.current) return;
                      const clean = newCounterName.trim();
                      if (!clean) return;
                      isSavingCounterRef.current = true;
                      setIsSavingCounter(true);
                      try {
                        const res = await fetch('/api/register/counters', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name: clean })
                        });
                        if (res.ok) {
                          const created = await res.json();
                          setCounters(prev => [...prev.filter(c => c.id !== created.id), created]);
                          setCounterName(created.name);
                          setIsAddingCounter(false);
                        } else {
                          const errData = await res.json().catch(() => ({}));
                          setError(errData.error || 'Failed to add counter');
                        }
                      } catch (err: any) {
                        setError(err.message || 'Error adding counter');
                      } finally {
                        isSavingCounterRef.current = false;
                        setIsSavingCounter(false);
                      }
                    }}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors"
                  >
                    {isSavingCounter ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAddingCounter(false)}
                    className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-semibold transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Opening Cash Float (DT) *
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                required
                value={openingCash}
                onChange={e => setOpeningCash(e.target.value)}
                placeholder="100.000"
                className="w-full text-lg font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                Cash drawer starting balance
              </span>
            </div>

            {error && (
              <p className="text-xs text-rose-600 font-semibold bg-rose-50 border border-rose-200 p-2 rounded-lg">
                {error}
              </p>
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
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm shadow transition-colors"
              >
                {submitting ? 'Opening...' : 'Start Session'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleCloseSubmit} className="p-5 space-y-4">
            {openSessions.length > 1 && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Session de caisse à clôturer *
                </label>
                <select
                  value={selectedSessionToCloseId}
                  onChange={e => setSelectedSessionToCloseId(e.target.value)}
                  className="w-full text-xs font-bold px-3 py-2 border border-slate-300 rounded-xl bg-slate-50 focus:ring-2 focus:ring-rose-500 focus:outline-none"
                >
                  {openSessions.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.counter_name} — {s.session_number} (Fond: {formatMoney(s.opening_cash)})
                    </option>
                  ))}
                </select>
                {onSelectSession && (
                  <button
                    type="button"
                    onClick={() => {
                      const chosen = openSessions.find(s => s.id === selectedSessionToCloseId);
                      if (chosen) {
                        onSelectSession(chosen);
                        onClose();
                      }
                    }}
                    className="text-[11px] text-emerald-700 hover:text-emerald-900 font-bold mt-1.5 inline-block"
                  >
                    → Basculer sur cette caisse (Travailler avec {openSessions.find(s => s.id === selectedSessionToCloseId)?.counter_name})
                  </button>
                )}
              </div>
            )}

            {/* Summary Box */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Session:</span>
                <span className="font-bold text-slate-900 font-mono">
                  {(openSessions.find(s => s.id === selectedSessionToCloseId) || activeSession)?.session_number} (
                  {(openSessions.find(s => s.id === selectedSessionToCloseId) || activeSession)?.counter_name})
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Expected Cash in Drawer:</span>
                <span className="font-bold text-slate-900 font-mono">
                  {formatMoney(expectedCash)}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Counted Physical Cash (DT) *
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                required
                autoFocus
                value={closingCountedCash}
                onChange={e => setClosingCountedCash(e.target.value)}
                placeholder="0.000"
                className="w-full text-lg font-bold font-mono px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            {/* Variance indicator */}
            <div
              className={`p-3 rounded-xl border flex items-center justify-between text-xs font-bold ${
                variance === 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : variance > 0
                  ? 'bg-blue-50 border-blue-200 text-blue-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              <span>Cash Variance:</span>
              <span className="text-sm font-mono font-black">
                {variance > 0 ? `+${formatMoney(variance)} (Over)` : variance < 0 ? `${formatMoney(variance)} (Short)` : '0.000 DT (Exact)'}
              </span>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Closing Notes / Audit Remarks
              </label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. End of shift, drawer reconciled cleanly"
                className="w-full text-sm px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            {error && (
              <p className="text-xs text-rose-600 font-semibold bg-rose-50 border border-rose-200 p-2 rounded-lg">
                {error}
              </p>
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
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-sm shadow transition-colors"
              >
                {submitting ? 'Closing...' : 'Close Session'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
