import React, { useState, useEffect } from 'react';
import { CLIENT_BUILD_ID } from '../../version.js';

export const UpdateBanner: React.FC = () => {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [serverVersion, setServerVersion] = useState<string>('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const checkVersion = async () => {
      try {
        const res = await fetch('/api/version');
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted && data.build_id && data.build_id !== CLIENT_BUILD_ID) {
          setUpdateAvailable(true);
          setServerVersion(data.version || data.build_id);
        }
      } catch {
        // Offline or server unreachable: silent no-op
      }
    };

    checkVersion();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', checkVersion);
      return () => {
        isMounted = false;
        window.removeEventListener('online', checkVersion);
      };
    }
  }, []);

  if (!updateAvailable || dismissed) return null;

  return (
    <div
      role="alert"
      className="bg-amber-500 text-slate-950 px-4 py-2 flex items-center justify-between text-xs sm:text-sm font-semibold shadow-md z-50 shrink-0"
    >
      <div className="flex items-center gap-2">
        <span className="font-bold">Mise à jour disponible :</span>
        <span>Nouvelle version du serveur détectée ({serverVersion}).</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-white text-slate-950 hover:bg-amber-50 font-bold px-3 py-1 rounded shadow-sm text-xs transition-colors"
        >
          Recharger
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-slate-950 hover:text-black p-1 rounded font-bold text-base leading-none"
          aria-label="Ignorer"
        >
          ×
        </button>
      </div>
    </div>
  );
};
