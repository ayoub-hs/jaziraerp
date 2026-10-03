import React, { useState } from 'react';
import { X, Shield, KeyRound, Lock, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { authService } from '../../services/authService.js';

interface AuthCredentialsModalProps {
  isOpen: boolean;
  mode: 'SETUP' | 'CHANGE';
  onClose: () => void;
  onSuccess?: () => void;
}

export const AuthCredentialsModal: React.FC<AuthCredentialsModalProps> = ({
  isOpen,
  mode,
  onClose,
  onSuccess
}) => {
  // Setup fields
  const [shopName, setShopName] = useState('Société Al Jazira SHSP');
  const [setupPin, setSetupPin] = useState('');
  const [confirmSetupPin, setConfirmSetupPin] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [confirmSetupPassword, setConfirmSetupPassword] = useState('');

  // Change fields
  const [changeType, setChangeType] = useState<'PIN' | 'PASSWORD'>('PIN');
  const [currentSecret, setCurrentSecret] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!/^\d{4}$/.test(setupPin.trim())) {
      setError('PIN must be exactly 4 digits');
      return;
    }
    if (setupPin !== confirmSetupPin) {
      setError('PINs do not match');
      return;
    }
    if (setupPassword.trim().length < 4) {
      setError('Master Password must be at least 4 characters');
      return;
    }
    if (setupPassword !== confirmSetupPassword) {
      setError('Master Passwords do not match');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: setupPin.trim(),
          password: setupPassword.trim(),
          shop_name: shopName.trim()
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to complete initial security setup');
      }

      await authService.cacheCredentials(setupPin.trim(), setupPassword.trim());
      setSuccess('Security credentials configured successfully!');
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'Error configuring security credentials');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentSecret.trim()) {
      setError('Current PIN or Master Password is required');
      return;
    }

    const payload: any = { current_secret: currentSecret.trim() };

    if (changeType === 'PIN') {
      if (!/^\d{4}$/.test(newPin.trim())) {
        setError('New PIN must be exactly 4 digits');
        return;
      }
      if (newPin !== confirmNewPin) {
        setError('New PINs do not match');
        return;
      }
      payload.new_pin = newPin.trim();
    } else {
      if (newPassword.trim().length < 4) {
        setError('New Master Password must be at least 4 characters');
        return;
      }
      if (newPassword !== confirmNewPassword) {
        setError('New Master Passwords do not match');
        return;
      }
      payload.new_password = newPassword.trim();
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update credentials');
      }

      if (payload.new_pin) {
        await authService.cacheCredentials(payload.new_pin);
      }
      if (payload.new_password) {
        await authService.cacheCredentials('', payload.new_password);
      }

      setSuccess('Credentials updated successfully!');
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'Error updating credentials');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                {mode === 'SETUP' ? 'Initial Security Setup' : 'Security Settings'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {mode === 'SETUP'
                  ? 'Configure 4-digit counter PIN and master recovery password'
                  : 'Update your counter unlock PIN or master password'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5">
          {success ? (
            <div className="text-center py-6 space-y-3">
              <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto" />
              <h4 className="font-bold text-slate-800 text-sm">{success}</h4>
            </div>
          ) : mode === 'SETUP' ? (
            <form onSubmit={handleSetupSubmit} className="space-y-4 text-xs">
              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 mb-1">Company / Shop Name</label>
                <input
                  type="text"
                  required
                  value={shopName}
                  onChange={e => setShopName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-semibold"
                />
              </div>

              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-3">
                <span className="font-black text-slate-700 block uppercase tracking-wider text-[10px]">
                  1. Counter Unlock PIN (4 Digits)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1 text-[11px]">4-Digit PIN *</label>
                    <input
                      type="password"
                      maxLength={4}
                      pattern="[0-9]{4}"
                      required
                      placeholder="e.g. 1234"
                      value={setupPin}
                      onChange={e => setSetupPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-center tracking-widest text-sm font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1 text-[11px]">Confirm PIN *</label>
                    <input
                      type="password"
                      maxLength={4}
                      pattern="[0-9]{4}"
                      required
                      placeholder="e.g. 1234"
                      value={confirmSetupPin}
                      onChange={e => setConfirmSetupPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-center tracking-widest text-sm font-bold"
                    />
                  </div>
                </div>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-3">
                <span className="font-black text-slate-700 block uppercase tracking-wider text-[10px]">
                  2. Master Password (Recovery & Admin)
                </span>
                <div className="space-y-2">
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1 text-[11px]">Master Password *</label>
                    <input
                      type="password"
                      required
                      placeholder="At least 4 characters"
                      value={setupPassword}
                      onChange={e => setSetupPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl font-medium"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1 text-[11px]">Confirm Master Password *</label>
                    <input
                      type="password"
                      required
                      placeholder="Re-enter master password"
                      value={confirmSetupPassword}
                      onChange={e => setConfirmSetupPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl font-medium"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5"
                >
                  {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  <span>Save Security Credentials</span>
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleChangeSubmit} className="space-y-4 text-xs">
              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Current Credential */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Current PIN or Master Password *
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter current PIN or password to authorize"
                  value={currentSecret}
                  onChange={e => setCurrentSecret(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                />
              </div>

              {/* Toggle Change Type */}
              <div className="flex border-b border-slate-200 gap-4 font-bold text-xs">
                <button
                  type="button"
                  onClick={() => setChangeType('PIN')}
                  className={`pb-2 border-b-2 transition-colors ${
                    changeType === 'PIN'
                      ? 'border-emerald-600 text-emerald-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Change 4-Digit PIN
                </button>
                <button
                  type="button"
                  onClick={() => setChangeType('PASSWORD')}
                  className={`pb-2 border-b-2 transition-colors ${
                    changeType === 'PASSWORD'
                      ? 'border-emerald-600 text-emerald-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Change Master Password
                </button>
              </div>

              {changeType === 'PIN' ? (
                <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1 text-[11px]">New 4-Digit PIN *</label>
                    <input
                      type="password"
                      maxLength={4}
                      pattern="[0-9]{4}"
                      required
                      placeholder="e.g. 5678"
                      value={newPin}
                      onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-center tracking-widest text-sm font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1 text-[11px]">Confirm New PIN *</label>
                    <input
                      type="password"
                      maxLength={4}
                      pattern="[0-9]{4}"
                      required
                      placeholder="e.g. 5678"
                      value={confirmNewPin}
                      onChange={e => setConfirmNewPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-center tracking-widest text-sm font-bold"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-2 p-3 bg-slate-50 rounded-xl border border-slate-200/80">
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1 text-[11px]">New Master Password *</label>
                    <input
                      type="password"
                      required
                      placeholder="At least 4 characters"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-600 mb-1 text-[11px]">Confirm New Password *</label>
                    <input
                      type="password"
                      required
                      placeholder="Re-enter new password"
                      value={confirmNewPassword}
                      onChange={e => setConfirmNewPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-1.5"
                >
                  {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  <span>Update Credentials</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
