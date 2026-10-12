import React, { useState, useEffect } from 'react';
import { CLIENT_BUILD_ID, CLIENT_VERSION } from '../../version.js';
import { isNativeApp } from '../../services/serverUrl.js';
import { evaluateUpdate, isDismissed, markDismissed, type UpdateInfo } from '../../utils/updateCheck.js';

async function reloadWithFreshWorker(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.update();
        reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
      }
    }
  } catch {
    /* fall through to plain reload */
  }
  window.location.reload();
}

export const UpdateBanner: React.FC = () => {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const checkVersion = async () => {
      try {
        const res = await fetch('/api/version');
        if (!res.ok) return;
        const data = await res.json();
        const result = evaluateUpdate(
          data,
          { version: CLIENT_VERSION, buildId: CLIENT_BUILD_ID },
          isNativeApp()
        );
        if (isMounted && result) {
          setInfo(result);
          setDismissed(isDismissed(result.buildId));
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

  if (!info || dismissed) return null;

  const dismiss = () => {
    markDismissed(info.buildId);
    setDismissed(true);
  };

  return (
    <div
      role="alert"
      className="bg-amber-500 text-slate-950 px-4 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs sm:text-sm font-semibold shadow-md z-50 shrink-0"
    >
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-bold">Mise à jour disponible :</span>
        <span>
          {info.kind === 'app'
            ? `Nouvelle version de l'application (${info.label}). Réinstallez l'APK.`
            : `Nouvelle version du serveur détectée (${info.label}).`}
        </span>
      </div>
      <div className="flex items-center gap-2 self-end sm:self-auto">
        {info.kind === 'web' && (
          <button
            type="button"
            onClick={() => void reloadWithFreshWorker()}
            className="bg-white text-slate-950 hover:bg-amber-50 font-bold px-3 min-h-[44px] sm:min-h-0 sm:py-1 rounded shadow-sm text-xs transition-colors"
          >
            Recharger
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="text-slate-950 hover:text-black min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:p-1 rounded font-bold text-lg leading-none"
          aria-label="Ignorer"
        >
          ×
        </button>
      </div>
    </div>
  );
};
