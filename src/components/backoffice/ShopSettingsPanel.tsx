import React, { useState, useEffect, useRef } from 'react';
import { Settings, Save, CheckCircle2, AlertCircle, RefreshCw, Store, KeyRound } from 'lucide-react';
import { getShopInfo, setCachedShopInfo, type ShopInfo } from '../../services/shopInfo.js';
import { AuthCredentialsModal } from '../shared/AuthCredentialsModal.js';
import { authService } from '../../services/authService.js';

export const ShopSettingsPanel: React.FC = () => {
  const [shopName, setShopName] = useState('');
  const [shopSubtitle, setShopSubtitle] = useState('');
  const [shopAddress, setShopAddress] = useState('');
  const [shopPhone, setShopPhone] = useState('');
  const [taxId, setTaxId] = useState('');
  const [defaultRetailMarkup, setDefaultRetailMarkup] = useState('');
  const [defaultWholesaleMarkup, setDefaultWholesaleMarkup] = useState('');

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAuthConfigured, setIsAuthConfigured] = useState<boolean>(authService.isConfigured());

  useEffect(() => {
    loadSettings();
    authService.syncStatus().then(st => setIsAuthConfigured(st.configured));
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
      setDefaultRetailMarkup(cached.default_retail_markup_percent || '');
      setDefaultWholesaleMarkup(cached.default_wholesale_markup_percent || '');

      const res = await fetch('/api/settings/shop');
      if (res.ok) {
        const data: ShopInfo = await res.json();
        setShopName(data.shop_name);
        setShopSubtitle(data.shop_subtitle);
        setShopAddress(data.shop_address);
        setShopPhone(data.shop_phone);
        setTaxId(data.tax_id);
        setDefaultRetailMarkup(data.default_retail_markup_percent || '');
        setDefaultWholesaleMarkup(data.default_wholesale_markup_percent || '');
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
        tax_id: taxId,
        default_retail_markup_percent: defaultRetailMarkup,
        default_wholesale_markup_percent: defaultWholesaleMarkup
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
      setDefaultRetailMarkup(saved.default_retail_markup_percent || '');
      setDefaultWholesaleMarkup(saved.default_wholesale_markup_percent || '');
      setCachedShopInfo(saved);

      setStatusMsg({
        type: 'success',
        text: 'Paramètres enregistrés avec succès'
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
            <h1 className="text-xl font-black text-slate-900">Paramètres de l'entreprise</h1>
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
            Nom de l'entreprise *
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
          <p className="text-pos-badge text-slate-600 mt-1">Affiché en en-tête principal (max 60 caractères).</p>
        </div>

        {/* Shop Subtitle */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
            Sous-titre
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
          <p className="text-pos-badge text-slate-600 mt-1">Activité ou slogan, affiché sous le nom (max 60 caractères).</p>
        </div>

        {/* Address */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
            Adresse
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
          <p className="text-pos-badge text-slate-600 mt-1">Adresse physique complète (max 120 caractères). Si vide, non imprimée.</p>
        </div>

        {/* Grid: Phone & Tax ID */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Phone */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Téléphone
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
            <p className="text-pos-badge text-slate-600 mt-1">Numéro de contact (max 30 caractères). Si vide, non imprimé.</p>
          </div>

          {/* Tax ID */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Matricule fiscal (MF)
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
            <p className="text-pos-badge text-slate-600 mt-1">Identifiant fiscal légal (max 30 caractères).</p>
          </div>
        </div>

        {/* Default Markups for Pricing Suggestions */}
        <div className="pt-3 border-t border-slate-100">
          <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
            Marges par défaut (%)
          </h2>
          <p className="text-pos-badge text-slate-600 mb-3">
            Pourcentages de marge utilisés pour suggérer les prix de vente dans le formulaire de création de produit. Laisser vide si aucune suggestion par défaut.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Marge détail par défaut (%)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="1000"
                value={defaultRetailMarkup}
                onChange={e => setDefaultRetailMarkup(e.target.value)}
                placeholder="ex: 30"
                disabled={isLoading || isSaving}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-mono font-semibold text-slate-900 bg-white disabled:bg-slate-50"
              />
              <p className="text-pos-badge text-slate-600 mt-1">Entre 0 et 1000 % (ex: 30 pour 30%).</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Marge gros par défaut (%)
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="1000"
                value={defaultWholesaleMarkup}
                onChange={e => setDefaultWholesaleMarkup(e.target.value)}
                placeholder="ex: 20"
                disabled={isLoading || isSaving}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-mono font-semibold text-slate-900 bg-white disabled:bg-slate-50"
              />
              <p className="text-pos-badge text-slate-600 mt-1">Entre 0 et 1000 % (ex: 20 pour 20%).</p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
          <button
            type="submit"
            disabled={isLoading || isSaving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold text-sm shadow-sm transition-all active:scale-95"
          >
            {isSaving ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>Enregistrer</span>
          </button>
        </div>
      </form>

      {/* Security Section */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900">Sécurité</h2>
            <p className="text-xs text-slate-600 font-medium mt-0.5">
              Code PIN de déverrouillage de caisse et mot de passe principal administrateur.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <div>
            <div className="text-xs font-bold text-slate-700">
              {isAuthConfigured ? 'Sécurité configurée' : 'Sécurité non configurée'}
            </div>
            <p className="text-pos-badge text-slate-600 mt-0.5">
              {isAuthConfigured
                ? 'Le code PIN et le mot de passe principal sont actifs.'
                : 'Définissez un code PIN pour verrouiller l\'accès à la caisse.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsAuthModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
          >
            <KeyRound className="w-3.5 h-3.5 text-blue-400" />
            <span>{isAuthConfigured ? 'Modifier le code PIN / MDP' : 'Configurer le code PIN'}</span>
          </button>
        </div>
      </div>

      <AuthCredentialsModal
        isOpen={isAuthModalOpen}
        mode={isAuthConfigured ? 'CHANGE' : 'SETUP'}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={() => {
          setIsAuthConfigured(true);
          setIsAuthModalOpen(false);
        }}
      />
    </div>
  );
};
