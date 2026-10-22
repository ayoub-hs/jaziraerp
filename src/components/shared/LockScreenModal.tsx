import React, { useState, useEffect } from 'react';
import { Lock, Unlock, KeyRound, AlertCircle, Shield, ArrowRight, RefreshCw } from 'lucide-react';
import { authService } from '../../services/authService.js';
import { AuthCredentialsModal } from './AuthCredentialsModal.js';
import { useModalScanPause } from '../../hooks/useModalScanPause.js';

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
  useModalScanPause(isLocked);

  const effectiveShopName = shopName || authService.getShopName();
  const [pin, setPin] = useState<string>('');
  const [lockoutRemaining, setLockoutRemaining] = useState<number>(() => authService.getLockoutRemainingSeconds());
  const [error, setError] = useState<string | null>(() => {
    const rem = authService.getLockoutRemainingSeconds();
    return rem > 0 ? `Trop de tentatives. Veuillez patienter ${rem} seconde${rem > 1 ? 's' : ''}.` : null;
  });
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

  // Periodic lockout countdown timer
  useEffect(() => {
    if (!isLocked) return;
    const interval = setInterval(() => {
      const remaining = authService.getLockoutRemainingSeconds();
      setLockoutRemaining(remaining);
      if (remaining > 0) {
        setError(`Trop de tentatives. Veuillez patienter ${remaining} seconde${remaining > 1 ? 's' : ''}.`);
      } else if (lockoutRemaining > 0 && remaining === 0) {
        setError(null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isLocked, lockoutRemaining]);

  // Handle physical keyboard typing
  useEffect(() => {
    if (!isLocked) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isMasterMode || lockoutRemaining > 0) return;

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
  }, [isLocked, pin, isMasterMode, lockoutRemaining]);

  // Auto-submit when 4 digits are entered
  useEffect(() => {
    if (pin.length === 4 && !isMasterMode && isLocked && lockoutRemaining === 0) {
      submitPin(pin);
    }
  }, [pin, isMasterMode, isLocked, lockoutRemaining]);

  const handleDigitPress = (digit: string) => {
    if (lockoutRemaining > 0) return;
    if (pin.length < 4) {
      setError(null);
      setPin(prev => prev + digit);
    }
  };

  const handleBackspace = () => {
    if (lockoutRemaining > 0) return;
    setError(null);
    setPin(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    if (lockoutRemaining > 0) return;
    setError(null);
    setPin('');
  };

  const submitPin = async (inputPin: string) => {
    const remaining = authService.getLockoutRemainingSeconds();
    if (remaining > 0) {
      setLockoutRemaining(remaining);
      setError(`Trop de tentatives. Veuillez patienter ${remaining} seconde${remaining > 1 ? 's' : ''}.`);
      setPin('');
      return;
    }

    try {
      setIsVerifying(true);
      setError(null);
      const success = await authService.unlock(inputPin, false);
      if (success) {
        setPin('');
        setError(null);
        setLockoutRemaining(0);
        onUnlocked();
      } else {
        const remainingAfter = authService.getLockoutRemainingSeconds();
        setLockoutRemaining(remainingAfter);
        if (remainingAfter > 0) {
          setError(`Trop de tentatives. Veuillez patienter ${remainingAfter} seconde${remainingAfter > 1 ? 's' : ''}.`);
        } else {
          setError('Code PIN incorrect. Veuillez réessayer.');
        }
        setPin('');
      }
    } catch {
      setError('Échec du déverrouillage. Veuillez réessayer.');
      setPin('');
    } finally {
      setIsVerifying(false);
    }
  };

  const submitMasterPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterPassword.trim()) return;

    const remaining = authService.getLockoutRemainingSeconds();
    if (remaining > 0) {
      setLockoutRemaining(remaining);
      setError(`Trop de tentatives. Veuillez patienter ${remaining} seconde${remaining > 1 ? 's' : ''}.`);
      return;
    }

    try {
      setIsVerifying(true);
      setError(null);
      const success = await authService.unlock(masterPassword, true);
      if (success) {
        setMasterPassword('');
        setIsMasterMode(false);
        setError(null);
        setLockoutRemaining(0);
        onUnlocked();
      } else {
        const remainingAfter = authService.getLockoutRemainingSeconds();
        setLockoutRemaining(remainingAfter);
        if (remainingAfter > 0) {
          setError(`Trop de tentatives. Veuillez patienter ${remainingAfter} seconde${remainingAfter > 1 ? 's' : ''}.`);
        } else {
          setError('Mot de passe maître incorrect.');
        }
      }
    } catch {
      setError('Échec de la vérification du mot de passe maître.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 backdrop-blur-xl p-2 sm:p-4 select-none animate-fadeIn overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl max-w-sm w-full p-4 sm:p-6 flex flex-col items-center text-center max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto my-auto">
        {/* Lock Icon & Header */}
        <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-emerald-700/20 border border-emerald-500/30 flex items-center justify-center mb-2 sm:mb-3">
          <Lock className="w-5 h-5 sm:w-7 sm:h-7 text-emerald-400" />
        </div>

        <h2 className="text-base sm:text-lg font-black text-white">{effectiveShopName}</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          {isMasterMode ? 'Déverrouillage par mot de passe maître' : 'Saisir le code PIN caisse (4 chiffres)'}
        </p>

        {/* Error Alert */}
        {error && (
          <div className="mt-2 sm:mt-3 w-full bg-rose-950/60 border border-rose-800/60 text-rose-300 px-3 py-1.5 rounded-xl text-xs flex items-center justify-center gap-1.5 animate-shake">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Mode 1: 4-Digit PIN Numpad */}
        {!isMasterMode ? (
          <div className="w-full mt-2 sm:mt-5">
            {/* 4 PIN Dots Indicator */}
            <div className="flex justify-center gap-3 sm:gap-4 mb-3 sm:mb-6">
              {[0, 1, 2, 3].map(index => {
                const filled = index < pin.length;
                return (
                  <div
                    key={index}
                    className={`w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full transition-all duration-200 ${
                      filled
                        ? 'bg-emerald-500 scale-110 shadow-[0_0_10px_rgba(16,185,129,0.7)]'
                        : 'bg-slate-800 border-2 border-slate-700'
                    }`}
                  />
                );
              })}
            </div>

            {/* Numeric Keypad */}
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5 max-w-[260px] mx-auto">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleDigitPress(num)}
                  disabled={isVerifying || lockoutRemaining > 0}
                  className="h-10 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 active:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-mono text-lg sm:text-xl font-bold border border-slate-700/60 transition-all flex items-center justify-center active:scale-95 shadow-sm"
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={handleClear}
                disabled={isVerifying || pin.length === 0 || lockoutRemaining > 0}
                className="h-10 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-800/40 hover:bg-slate-700/60 disabled:opacity-40 disabled:cursor-not-allowed text-slate-400 font-bold text-xs border border-slate-800 transition-colors flex items-center justify-center active:scale-95"
              >
                Effacer
              </button>
              <button
                type="button"
                onClick={() => handleDigitPress('0')}
                disabled={isVerifying || lockoutRemaining > 0}
                className="h-10 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-800/80 hover:bg-slate-700/80 active:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-mono text-lg sm:text-xl font-bold border border-slate-700/60 transition-all flex items-center justify-center active:scale-95 shadow-sm"
              >
                0
              </button>
              <button
                type="button"
                onClick={handleBackspace}
                disabled={isVerifying || pin.length === 0 || lockoutRemaining > 0}
                className="h-10 sm:h-14 rounded-xl sm:rounded-2xl bg-slate-800/40 hover:bg-slate-700/60 disabled:opacity-40 disabled:cursor-not-allowed text-slate-400 font-bold text-xs border border-slate-800 transition-colors flex items-center justify-center active:scale-95"
              >
                Suppr
              </button>
            </div>

            {/* Switch to Master Password */}
            <div className="mt-3 sm:mt-5 pt-2 sm:pt-3 border-t border-slate-800/80 text-center">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setIsMasterMode(true);
                }}
                className="text-xs text-slate-400 hover:text-emerald-400 font-semibold transition-colors flex items-center justify-center gap-1 mx-auto"
              >
                <KeyRound className="w-3.5 h-3.5" />
                PIN oublié ? Utiliser le mot de passe maître
              </button>
            </div>
          </div>
        ) : (
          /* Mode 2: Master Password Form */
          <form onSubmit={submitMasterPassword} className="w-full mt-4 space-y-3">
            <div>
              <input
                type="password"
                placeholder="Saisir le mot de passe maître..."
                value={masterPassword}
                onChange={e => setMasterPassword(e.target.value)}
                autoFocus
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <button
              type="submit"
              disabled={isVerifying || !masterPassword.trim() || lockoutRemaining > 0}
              className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
            >
              {isVerifying ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Vérification...
                </>
              ) : (
                <>
                  <Unlock className="w-4 h-4" />
                  Déverrouiller avec le mot de passe
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
              Retour au clavier PIN
            </button>
          </form>
        )}

        {/* Offline indicator note */}
        <div className="mt-2 sm:mt-3 text-pos-badge text-slate-500">
          Déverrouillage sécurisé • Fonctionne 100% hors-ligne
        </div>
      </div>
    </div>
  );
};
