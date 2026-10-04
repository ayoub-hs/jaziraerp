import React, { useState, useEffect, useRef } from 'react';
import { Settings, Save, CheckCircle2, AlertCircle, RefreshCw, Store } from 'lucide-react';
import { getShopInfo, setCachedShopInfo, type ShopInfo } from '../../services/shopInfo.js';

export const ShopSettingsPanel: React.FC = () => {
  const [shopName, setShopName] = useState('');
  const [shopSubtitle, setShopSubtitle] = useState('');
  const [shopAddress, setShopAddress] = useState('');
  const [shopPhone, setShopPhone] = useState('');
  const [taxId, setTaxId] = useState('');

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      // Initialize with cached info first
      const cached = getShopInfo();
      setShopName(cached.shop_name);
      setShopSubtitle(cached.shop_subtitle);
      setShopAddress(cached.shop_address);
      setShopPhone(cached.shop_phone);
      setTaxId(cached.tax_id);

      const res = await fetch('/api/settings/shop');
      if (res.ok) {
        const data: ShopInfo = await res.json();
        setShopName(data.shop_name);
        setShopSubtitle(data.shop_subtitle);
        setShopAddress(data.shop_address);
        setShopPhone(data.shop_phone);
        setTaxId(data.tax_id);
        setCachedShopInfo(data);
      }
    } catch (err: any) {
      console.warn('[ShopSettingsPanel] Failed to load settings from server:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    setStatusMsg(null);

    try {
      const payload = {
        shop_name: shopName,
        shop_subtitle: shopSubtitle,
        shop_address: shopAddress,
        shop_phone: shopPhone,
        tax_id: taxId
      };

      const res = await fetch('/api/settings/shop', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erreur lors de la sauvegarde des paramètres' }));
        throw new Error(err.error || 'Erreur lors de la sauvegarde des paramètres');
      }

      const saved: ShopInfo = await res.json();
      setShopName(saved.shop_name);
      setShopSubtitle(saved.shop_subtitle);
      setShopAddress(saved.shop_address);
      setShopPhone(saved.shop_phone);
      setTaxId(saved.tax_id);
      setCachedShopInfo(saved);

      setStatusMsg({
        type: 'success',
        text: 'Paramètres enregistrés avec succès / Settings saved successfully'
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err.message || 'Erreur inconnue lors de la sauvegarde'
      });
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
            <Store className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900">Paramètres de l'entreprise / Shop Settings</h1>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Coordonnées et mentions légales figurant sur les reçus thermiques et factures A4.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={loadSettings}
          disabled={isLoading || isSaving}
          className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          title="Rafraîchir"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Status Notifications */}
      {statusMsg && (
        <div
          className={`p-4 rounded-xl border flex items-center gap-2 text-sm ${
            statusMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {statusMsg.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
          )}
          <span className="font-semibold">{statusMsg.text}</span>
        </div>
      )}

      {/* Settings Form */}
      <form onSubmit={handleSave} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
        {/* Shop Name */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
            Nom de l'entreprise / Shop Name *
          </label>
          <input
            type="text"
            required
            maxLength={60}
            value={shopName}
            onChange={e => setShopName(e.target.value)}
            placeholder="Société Al Jazira SHSP"
            disabled={isLoading || isSaving}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-semibold text-slate-900 bg-white disabled:bg-slate-50"
          />
          <p className="text-[11px] text-slate-400 mt-1">Affiché en en-tête principal (max 60 caractères).</p>
        </div>

        {/* Shop Subtitle */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
            Sous-titre / Subtitle
          </label>
          <input
            type="text"
            maxLength={60}
            value={shopSubtitle}
            onChange={e => setShopSubtitle(e.target.value)}
            placeholder="Détergents & Hygiène"
            disabled={isLoading || isSaving}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-semibold text-slate-900 bg-white disabled:bg-slate-50"
          />
          <p className="text-[11px] text-slate-400 mt-1">Activité ou slogan, affiché sous le nom (max 60 caractères).</p>
        </div>

        {/* Address */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
            Adresse / Shop Address
          </label>
          <input
            type="text"
            maxLength={120}
            value={shopAddress}
            onChange={e => setShopAddress(e.target.value)}
            placeholder="Rue …, El May, Djerba"
            disabled={isLoading || isSaving}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-semibold text-slate-900 bg-white disabled:bg-slate-50"
          />
          <p className="text-[11px] text-slate-400 mt-1">Adresse physique complète (max 120 caractères). Si vide, non imprimée.</p>
        </div>

        {/* Grid: Phone & Tax ID */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Phone */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Téléphone / Phone Number
            </label>
            <input
              type="text"
              maxLength={30}
              value={shopPhone}
              onChange={e => setShopPhone(e.target.value)}
              placeholder="+216 …"
              disabled={isLoading || isSaving}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-semibold text-slate-900 bg-white disabled:bg-slate-50"
            />
            <p className="text-[11px] text-slate-400 mt-1">Numéro de contact (max 30 caractères). Si vide, non imprimé.</p>
          </div>

          {/* Tax ID */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Matricule Fiscal / Tax ID (MF)
            </label>
            <input
              type="text"
              maxLength={30}
              value={taxId}
              onChange={e => setTaxId(e.target.value)}
              placeholder="0000000/A/M/000"
              disabled={isLoading || isSaving}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-mono font-semibold text-slate-900 bg-white disabled:bg-slate-50"
            />
            <p className="text-[11px] text-slate-400 mt-1">Identifiant fiscal légal (max 30 caractères).</p>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
          <button
            type="submit"
            disabled={isLoading || isSaving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm shadow-sm transition-all active:scale-95"
          >
            {isSaving ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>Enregistrer / Save</span>
          </button>
        </div>
      </form>
    </div>
  );
};
