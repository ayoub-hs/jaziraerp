import React, { useState, useEffect } from 'react';
import { Lock, Unlock, KeyRound, AlertCircle, Shield, ArrowRight, RefreshCw } from 'lucide-react';
import { authService } from '../../services/authService.js';
import { AuthCredentialsModal } from './AuthCredentialsModal.js';

interface LockScreenModalProps {
  isLocked: boolean;
  onUnlocked: () => void;
  shopName?: string;
}

export const LockScreenModal: React.FC<LockScreenModalProps> = ({
  isLocked,
  onUnlocked,
  shopName
}) => {
  const effectiveShopName = shopName || authService.getShopName();
  const [pin, setPin] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isMasterMode, setIsMasterMode] = useState(false);
  const [masterPassword, setMasterPassword] = useState('');
  const [isConfigured, setIsConfigured] = useState<boolean>(authService.isConfigured());
  const [isSetupOpen, setIsSetupOpen] = useState(false);

  useEffect(() => {
    if (isLocked) {
      authService.syncStatus().then(st => {
        setIsConfigured(st.configured);
        if (!st.configured) {
          setIsSetupOpen(true);
        }
      });
    }
  }, [isLocked]);

  // Handle physical keyboard typing
  useEffect(() => {
    if (!isLocked) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isMasterMode) return;

      if (e.key >= '0' && e.key <= '9') {
        if (pin.length < 4) {
          handleDigitPress(e.key);
        }
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Escape') {
        handleClear();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLocked, pin, isMasterMode]);

  // Auto-submit when 4 digits are entered
  useEffect(() => {
    if (pin.length === 4 && !isMasterMode && isLocked) {
      submitPin(pin);
    }
  }, [pin, isMasterMode, isLocked]);

  const handleDigitPress = (digit: string) => {
    if (pin.length < 4) {
      setError(null);
      setPin(prev => prev + digit);
    }
  };

  const handleBackspace = () => {
    setError(null);
    setPin(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setError(null);
    setPin('');
  };

  const submitPin = async (inputPin: string) => {
    try {
      setIsVerifying(true);
      setError(null);
      const success = await authService.unlock(inputPin, false);
      if (success) {
        setPin('');
        onUnlocked();
      } else {
        setError('Incorrect PIN. Please try again.');
        setPin('');
      }
    } catch {
      setError('Unlock failed. Please try again.');
      setPin('');
    } finally {
      setIsVerifying(false);
    }
  };

  const submitMasterPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterPassword.trim()) return;

    try {
      setIsVerifying(true);
      setError(null);
      const success = await authService.unlock(masterPassword, true);
      if (success) {
        setMasterPassword('');
        setIsMasterMode(false);
        onUnlocked();
      } else {
        setError('Incorrect Master Password.');
      }
    } catch {
      setError('Master Password verification failed.');
    } finally {
      setIsVerifying(false);
    }
  };

  if (!isLocked) return null;

  // When credentials are not configured yet, or setup modal is explicitly opened:
  // Render ONLY AuthCredentialsModal so it is not superimposed on top of the PIN unlock pad.
  if (isSetupOpen || !isConfigured) {
    return (
      <AuthCredentialsModal
        isOpen={true}
        mode="SETUP"
        onClose={() => {
          setIsSetupOpen(false);
          if (!isConfigured) {
            onUnlocked();
          }
        }}
        onSuccess={() => {
          setIsSetupOpen(false);
          setIsConfigured(true);
          onUnlocked();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 backdrop-blur-xl p-4 select-none animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl max-w-sm w-full p-6 flex flex-col items-center text-center">
        {/* Lock Icon & Header */}
        <div className="w-14 h-14 rounded-2xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center mb-3">
          <Lock className="w-7 h-7 text-emerald-400" />
        </div>

        <h2 className="text-lg font-black text-white">{effectiveShopName}</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          {isMasterMode ? 'Master Password Unlock' : 'Enter 4-Digit Counter PIN'}
        </p>

        {/* Error Alert */}
        {error && (
          <div className="mt-3 w-full bg-rose-950/60 border border-rose-800/60 text-rose-300 px-3 py-1.5 rounded-xl text-xs flex items-center justify-center gap-1.5 animate-shake">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Mode 1: 4-Digit PIN Numpad */}
        {!isMasterMode ? (
          <div className="w-full mt-5">
            {/* 4 PIN Dots Indicator */}
            <div className="flex justify-center gap-4 mb-6">
              {[0, 1, 2, 3].map(index => {
                const filled = index < pin.length;
                return (
                  <div
                    key={index}
                    className={`w-4 h-4 rounded-full transition-all duration-200 ${
                      filled
                        ? 'bg-emerald-500 scale-110 shadow-[0_0_10px_rgba(16,185,129,0.7)]'
                        : 'bg-slate-800 border-2 border-slate-700'
                    }`}
                  />
                );
              })}
            </div>

            {/* Numeric Keypad */}
            <div className="grid grid-cols-3 gap-2.5 max-w-[260px] mx-auto">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleDigitPress(num)}
                  disabled={isVerifying}
                  className="h-14 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 active:bg-emerald-600 text-white font-mono text-xl font-bold border border-slate-700/60 transition-all flex items-center justify-center active:scale-95 shadow-sm"
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={handleClear}
                disabled={isVerifying || pin.length === 0}
                className="h-14 rounded-2xl bg-slate-800/40 hover:bg-slate-700/60 text-slate-400 font-bold text-xs border border-slate-800 transition-colors flex items-center justify-center active:scale-95"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => handleDigitPress('0')}
                disabled={isVerifying}
                className="h-14 rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 active:bg-emerald-600 text-white font-mono text-xl font-bold border border-slate-700/60 transition-all flex items-center justify-center active:scale-95 shadow-sm"
              >
                0
              </button>
              <button
                type="button"
                onClick={handleBackspace}
                disabled={isVerifying || pin.length === 0}
                className="h-14 rounded-2xl bg-slate-800/40 hover:bg-slate-700/60 text-slate-400 font-bold text-xs border border-slate-800 transition-colors flex items-center justify-center active:scale-95"
              >
                Del
              </button>
            </div>

            {/* Switch to Master Password */}
            <div className="mt-5 pt-3 border-t border-slate-800/80 text-center">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setIsMasterMode(true);
                }}
                className="text-xs text-slate-400 hover:text-emerald-400 font-semibold transition-colors flex items-center justify-center gap-1 mx-auto"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Forgot PIN? Use Master Password
              </button>
            </div>
          </div>
        ) : (
          /* Mode 2: Master Password Form */
          <form onSubmit={submitMasterPassword} className="w-full mt-4 space-y-3">
            <div>
              <input
                type="password"
                placeholder="Enter Master Password..."
                value={masterPassword}
                onChange={e => setMasterPassword(e.target.value)}
                autoFocus
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <button
              type="submit"
              disabled={isVerifying || !masterPassword.trim()}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
            >
              {isVerifying ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <Unlock className="w-4 h-4" />
                  Unlock with Password
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setError(null);
                setIsMasterMode(false);
              }}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs transition-colors"
            >
              Back to PIN Pad
            </button>
          </form>
        )}

        {/* Offline indicator note */}
        <div className="mt-3 text-[10px] text-slate-500">
          Single-User Secure Unlock • Works 100% Offline
        </div>
      </div>
    </div>
  );
};
