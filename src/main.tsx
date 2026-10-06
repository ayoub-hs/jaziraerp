import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initPwa } from './pwa';
import { installApiUrlPatch, isNativeApp } from './services/serverUrl.js';
import { BluetoothLowEnergy } from '@capgo/capacitor-bluetooth-low-energy';

// Capacitor native: bundled UI talks to the shop server via stored absolute
// URL, and Web Bluetooth calls route to the native BLE stack via the shim.
installApiUrlPatch();

if (isNativeApp()) {
  try {
    BluetoothLowEnergy.shimWebBluetooth();
  } catch (err) {
    console.warn('[ble] WebBluetooth shim install failed:', err);
  }
} else {
  initPwa(reload => {
    window.dispatchEvent(new CustomEvent('pwa-update-available', { detail: { reload } }));
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
