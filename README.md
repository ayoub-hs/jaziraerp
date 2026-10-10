# Al Jazira SHSP ERP & POS

Offline-first ERP & point-of-sale (Node.js + React, SQLite).

## Deployment

- The server binds `127.0.0.1` by default (`PORT`, default 3000). Override with
  `HOST` only when you know you need it.
- Remote access is through `tailscale serve` (tailnet only, never funnel)
  proxying to `http://127.0.0.1:3000`.
- Note: `localhost` and the `*.ts.net` address are separate browser origins
  with separate IndexedDB databases and separate offline sync queues. An
  offline sale queued on one origin will not appear on the other until each
  origin syncs with the server itself.

## PWA / offline shell

After one online visit the app shell works offline. A new deploy refreshes the
cache and the page shows an "update available — reload" banner. To force-reset
the offline shell, visit `/?nosw=1` (unregisters the service worker and clears
its caches).

## Android client (Capacitor)

Native shell around the same React UI, talking to the shop server over
LAN/Tailscale. First launch asks for the server URL (tested live, saved
on-device). Bluetooth printing goes through the Capgo BLE shim, so the
existing WebBluetooth ESC/POS path works unchanged (verified with MPT-II).

- Prereqs: Android SDK + NDK, JDK 21, `~/gradle/gradle-8.13` (repo wrapper
  version drift — local 8.13 satisfies AGP 8.13; do not use `/usr/bin/gradle` 4.x).
- Build: `npm run build && npx cap sync android`, then
  `JAVA_HOME=~/jdk-21 ~/gradle/gradle-8.13/bin/gradle assembleDebug`
  inside `android/`. APK:
  `android/app/build/outputs/apk/debug/app-debug.apk` (debug-signed).
- Server must be reachable from the phone (`HOST=0.0.0.0` or Tailscale IP);
  CORS already allowlists the app origin (`https://localhost`), traffic uses HTTPS over Tailscale.

## Release & Update Workflow

- **After every client change**:
  1. Run `npm run build` (this automatically computes a new build ID from git + timestamp, injects `VITE_BUILD_ID` into the client bundle, and records `dist/build-id.txt`).
  2. Restart the server (`npm start` or systemd service) so `/api/version` serves the new build ID.
  3. Rebuild and reinstall the Android APK **only if native code changed** (the APK bundles the web UI, so an older installed APK will see the non-blocking update banner pointing to the new server build until updated).

## Delivery Notes (Bons de Livraison)

- **1:1 Mapping**: Each Delivery Note (BL) is permanently mapped 1:1 to a completed sale (`delivery_notes.sale_id` UNIQUE).
- **Numbering**: Sequential daily format `BL-YYYYMMDD-XXXX`.
- **Price Modes**: Supports both "Avec prix (TTC)" and "Sans prix (Quantités seules)" toggle when printing.
- **Dual Signatures**: Standard carrier ("Transporteur / Livreur") and client ("Client / Réceptionnaire") acceptance blocks.
- **Scope & Boundaries**: Devis (quotes) and partial deliveries are deliberately out of scope for v1; each BL is generated for a finalized sale.

