import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initPwa } from './pwa';
import { installApiUrlPatch, isTauriApp } from './services/serverUrl.js';

// Tauri mobile: bundled UI talks to the shop server via stored absolute URL.
installApiUrlPatch();

if (!isTauriApp()) {
  initPwa(reload => {
    window.dispatchEvent(new CustomEvent('pwa-update-available', { detail: { reload } }));
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
