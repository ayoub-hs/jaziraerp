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
