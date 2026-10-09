import React, { useState } from 'react';
import { Server, Check, Loader2 } from 'lucide-react';
import { setServerUrl, DEFAULT_SERVER_URL } from '../../services/serverUrl.js';

interface ServerSetupProps {
  onSaved: (url: string) => void;
}

/**
 * First-launch gate for the native mobile build: the bundled UI has no
 * same-origin server, so the cashier enters the shop PC address once
 * (prefilled with Tailscale / cloud URL). Saved on-device.
 */
export const ServerSetup: React.FC<ServerSetupProps> = ({ onSaved }) => {
  const [url, setUrl] = useState(DEFAULT_SERVER_URL);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = url.trim().replace(/\/+$/, '');

  const handleSave = async () => {
    setError(null);
    if (!/^https?:\/\/.+/.test(normalized)) {
      setError(`Adresse invalide. Exemple: ${DEFAULT_SERVER_URL}`);
      return;
    }
    setTesting(true);
    try {
      // absolute fetch: the startup patch only rewrites root-relative paths
      const res = await fetch(`${normalized}/api/sync/pull`);
      if (!res.ok) {
        setError(`Serveur injoignable (HTTP ${res.status}). Vérifiez l'adresse et le réseau.`);
        return;
      }
      setServerUrl(normalized);
      onSaved(normalized);
    } catch (err: any) {
      setError(`Serveur injoignable (${err.message || 'réseau'}). Vérifiez le Wi-Fi / LAN.`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Server className="w-6 h-6 text-emerald-600" />
          <h1 className="text-lg font-black text-slate-900">Connexion au serveur</h1>
        </div>
        <p className="text-xs text-slate-600 font-semibold">
          Entrez l'adresse du serveur ERP. Exemple: <span className="font-mono">{DEFAULT_SERVER_URL}</span>
        </p>
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder={DEFAULT_SERVER_URL}
          className="w-full font-mono text-sm px-3 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
        />
        {error && (
          <div className="p-2.5 bg-rose-50 text-rose-800 rounded-xl text-xs font-bold">
            {error}
          </div>
        )}
        <button
          onClick={handleSave}
          disabled={testing}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl shadow text-sm transition-colors flex items-center justify-center gap-2"
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {testing ? 'Test de connexion...' : 'Tester & Enregistrer'}
        </button>
      </div>
    </div>
  );
};
