# Architecture & Design Plan: Client Ordering & Delivery System (Revised & Amended)
**Project:** Al Jazira SHSP ERP / POS  
**Target File:** `docs/plans/client-ordering.md`  
**Status:** PROPOSED PLAN ONLY (No implementation code, dependencies, or git state modified)  
**Business Identity:** Société Al Jazira SHSP, El May, Djerba, Tunisia  
**Author:** Lead Engineer  
**Date:** October 2026  

---

## Code Inspection & Baseline Analysis (FIRST STEP)

Before designing the client ordering feature, the following real codebase files were inspected line-by-line:
- `server/db/index.ts` & `server/db/schema.sql` (schema, migrations, WAL mode, foreign keys, `cleanupOldSettings`, counter seeding)
- `server/index.ts` (Express setup, CORS whitelist, port binding, route mounting, absence of process-level crash handlers)
- `server/routes/sales.ts:340-1300` (inline checkout handler, item processing, pricing, TVA 19%, retry loop, delivery note generation, `POST /:id/refund`, `POST /api/refunds`, `processRefund`, response shape)
- `server/routes/sync.ts:350-400` (catalog pull, offline sync flush, inline `INSERT INTO sales` duplication at ~line 362, `sync_processed` idempotency)
- `server/routes/customers.ts` (customer types, debt ledger, wallet balance; note: `credit_limit` does **not** exist in schema or code)
- `server/routes/containers.ts:140-240` (container types, customer container loans, `POST /transactions` with `quantity_owed` check and RETURN-above-owed guard)
- `server/routes/register.ts` & `server/services/registerService.ts` (register sessions, default `counter_name = 'Countertop'`, cash breakdown, expected cash calculation)
- `server/routes/backup.ts` & `server/services/backupService.ts` (`GET /api/backups`, `POST /api/backups`, `GET /api/backups/download/:filename`, `POST /api/backups/restore`; copies full SQLite file)
- `server/routes/auth.ts` (PIN hash, scrypt with salt, lockout logic)
- `server/utils/money.ts` (TND 3 decimal precision, millimes arithmetic, `calculateTaxBreakdown`, `calculateResellerPrice`)
- `server/utils/payments.ts` (`validateSalePayment` shared validation logic)
- `src/types/index.ts` (frontend data models)

### Inventory of Existing Components: Reuse vs Refactor vs Missing

| Component / Functionality | Status in Codebase | Source File Path | Reused / Refactor / Missing? | Details |
| :--- | :--- | :--- | :--- | :--- |
| **Database Connection & WAL** | Existing | `server/db/index.ts:11-36` | **REUSED AS-IS** | Shared `better-sqlite3` instance in WAL mode with `busy_timeout = 10000` and foreign keys enabled. |
| **Financial Arithmetic (TND 3 dec)** | Existing | `server/utils/money.ts:1-70` | **REUSED AS-IS** | `round3`, `addMoney`, `subtractMoney`, `multiplyMoney`, `calculateTaxBreakdown` (19% TVA), `calculateResellerPrice`. |
| **Catalog Price Resolution** | Existing | `server/routes/sales.ts:302-338` | **REUSED AS-IS** | `computeExpectedCatalogPrice(db, product, customer, packSizeId, packMultiplier)` resolves retail, wholesale, reseller discount % and pack multipliers. |
| **Sale Payment Validator** | Existing | `server/utils/payments.ts:42-118` | **REUSED AS-IS** | `validateSalePayment` enforces payment sum equality, non-negative amounts, change calculation, and tender validity. |
| **Idempotency Tracking** | Existing | `server/db/schema.sql:441-446` | **REUSED AS-IS** | `sync_processed` table (`client_id`, `action_type`, `processed_at`) for deduplication. |
| **Container Loan Math** | Existing | `server/utils/container.ts` | **REUSED AS-IS** | `calculateContainersNeeded` computes jerrycans required from product volume. |
| **Register Cash Tracking** | Existing | `server/services/registerService.ts:20-75` | **REUSED AS-IS** | `calculateSessionExpectedCash` accounts for all `sales.cash_paid` in the active session. |
| **Sale Creation Engine (POSIX / In-Store)** | Existing (Inline) | `server/routes/sales.ts:341-800` | **REFACTOR (Phase 0)** | Inline inside `salesRouter.post('/')`. `generateReceiptNumber` and `generateTicketNumber` are private. **Phase 0 Refactor** extracts shared `createSale(db, input)` into `server/services/saleService.ts` **verbatim**, preserving all validations, calculations, retry loops, and exact response shape. |
| **Offline Sync Sale Insert (Known Technical Debt)** | Existing (Inline) | `server/routes/sync.ts:362-420` | **LEFT UNTOUCHED (Known Debt)** | `sync.ts` contains its own inline `INSERT INTO sales` and item insertion logic for offline sync. **Phase 0 leaves this untouched** and records it as known technical debt. We do **not** claim a single unified sale engine across the repo. A drift test asserts schema parity between `sync.ts` and `createSale()`. |
| **Delivery Note (BL) Engine** | Existing | `server/routes/sales.ts:35-46`, `234-300` | **REFACTOR** | `delivery_notes.sale_id` is `NOT NULL UNIQUE REFERENCES sales(id)`. A legal BL cannot exist before a sale. Dispatch uses a Preparation Slip; BL is generated at delivery conversion with existing 3-attempt retry loop. |
| **Container Transaction Logic** | Existing | `server/routes/containers.ts:140-237` | **REFACTOR (Extracted Service)** | To prevent writing a third copy of container logic, extract `recordContainerTransaction(db, input)` from `POST /transactions` into `server/services/containerService.ts`. Reuses `quantity_owed` check, RETURN-above-owed guard, and `correction` flag. Order conversion calls this service inside its outer transaction. |
| **Counter "Livraison" Initialization** | Existing Pattern | `server/db/index.ts:109-118` | **REFACTOR (Idempotent Ensure-Insert)** | Add an idempotent `INSERT OR IGNORE INTO counters` for `'Livraison'`. Because `register.ts` defaults `counter_name` to `'Countertop'`, conversion explicitly targets `'Livraison'`. |
| **Credit Limit on Customers** | Missing | `server/db/schema.sql:138-149` | **MISSING (Phase 1a Scope)** | `credit_limit` does **not** exist in schema or code. Add nullable column `customers.credit_limit REAL DEFAULT NULL` and editable field in backoffice Customer Modal. Portal blocks credit checkout when credit exposure > limit; conversion modal warns the owner without hard block. |
| **Backup Management** | Existing | `server/routes/backup.ts:1-75` | **REUSED AS-IS** | `GET /api/backups`, `POST /api/backups`, `GET /api/backups/download/:filename`, `POST /api/backups/restore`. Copies full SQLite file. Protected by Tailscale tailnet only and directory `chmod 700`. |
| **Public Session Secret Storage** | Missing | Process Environment / Root File | **MISSING (Environment/File)** | Session signing secret `public_session_secret` is stored outside the database in an environment variable `PUBLIC_SESSION_SECRET` or root-only file `/etc/jazira/session.secret` (`chmod 600`), never in SQLite. |
| **Public Express Listener** | Missing | `server/index.ts` | **MISSING** | Second Express application instance on port `3001` with `trust proxy: 'loopback'` and synchronous/wrapped handlers. |
| **Public Data Access Layer (DAL)** | Missing | N/A | **MISSING** | `server/dal/publicOrdersDal.ts` using parameterized queries and read-only statements for catalog. |
| **Orders & Credentials Schema** | Missing | `server/db/schema.sql` | **MISSING** | Tables `client_orders`, `client_order_items`, `delivery_zones`, and `customer_auth_credentials` (empty, zero seed rows). |
| **Public Frontend Bundle** | Missing | `src/` | **MISSING** | Dedicated minimal client build (`dist-order/`), completely isolated from the admin ERP bundle. |

*(All entries above reflect the actual repository source code. Network and environment attributes are explicitly marked **UNVERIFIED** or **INFERRED**).*

---

## 1. Assumptions & Owner Facts

### 1.1 Assumptions & Owner Facts

1. **Operating Geography & Identity:**  
   *Owner Fact:* The business is **Société Al Jazira SHSP, located in El May, Djerba**. All references to "Route de Gabès Km 3.5, Sfax" and "+216 74 000 000" were legacy placeholder defaults cleaned up by `cleanupOldSettings` (`server/db/index.ts:153`).  
   *Delivery Territory:* Djerba, Zarzis, Medenine, Ben Guerdane.  
   *Fees & Minimums:* Delivery fees and minimum order amounts default to **0.000 DT** for all areas initially, stored as configurable fields per area in `delivery_zones`. (Any specific figures like 30, 50, 70 DT discussed previously are strictly illustrative placeholders; default stays 0.000 DT until the owner configures values).  
   *Schedule:* Monday to Saturday, 08:00 to 17:00. Closed Sunday.

2. **Operator Role & Delivery Reconciliation:**  
   *Owner Fact:* The owner handles order review, manufacturing, and deliveries personally.  
   *Delivery Workflow (v1):* The owner prints a physical Preparation Slip (`Fiche de Préparation`), delivers goods to the customer door, collects cash/signatures, and performs the conversion in the ERP.  
   *Future Delivery Personnel Hook:* A future dedicated delivery driver will require a separate panel, separate credentials, and a cash-handover ledger. The schema includes an optional nullable hook `delivered_by TEXT DEFAULT NULL`.

3. **Orders Placed Outside Operating Hours:**  
   *Assumption:* The ordering portal remains open 24/7 as long as the shop PC is powered on.  
   *Policy:* Orders placed between 17:00 and 08:00, or on Sundays, are queued with status `NEW` and processed the next working morning starting at 08:00.  
   *Copy on Order Page (French):*  
   *« Commandes traitées du lundi au samedi, de 08h00 à 17h00. Toute commande enregistrée en dehors de ces horaires ou le dimanche sera validée dès l'ouverture le jour ouvrable suivant. »*

4. **Dynamic DNS & Network Exposure:**  
   *Owner Fact:* The owner possesses a `deSEC.io` dynamic DNS domain (`<host>.dedyn.io`). The router WAN IP matches the public IP (no CGNAT), and the owner can forward ports 80/443 to the shop PC.  
   *Verification Status:* **UNVERIFIED** until tested by the owner from an external mobile data connection.

5. **Customer Phone Numbers & Communication:**  
   *Phone Source of Truth:* `customers.phone` is the sole source of truth.  
   *Phone Normalization Rule:* All phone numbers are strictly normalized to **8 digits** (stripping whitespace, hyphens, dots, parentheses, and international prefixes like `+216` or `00216`).  
   *Uniqueness & Activation Invariant:* Clicking **« Activer Espace Revendeur »** refuses activation if `customers.phone` is missing/blank or if the normalized 8-digit number is shared by another active customer in the database.  
   *Policy:* The owner calls the customer directly to confirm new public orders before loading goods. No third-party SMS gateway is used.

### 1.2 Unanswered Questions & Recommended Defaults

- **Q1: What is the exact deSEC domain name?**  
  *Code Status:* BLANK (not in repo; must never be hardcoded per Rule 1.5).  
  *Recommended Default:* Loaded from the environment variable `PUBLIC_ORDER_DOMAIN` (e.g. `aljazira.dedyn.io`).  
  *Impact if Wrong:* Caddy fails TLS-SNI handshake until `PUBLIC_ORDER_DOMAIN` in Caddyfile is configured.

- **Q2: Should distant delivery areas (e.g. Ben Guerdane, Medenine) have dedicated delivery days?**  
  *Observation:* Driving from El May to Ben Guerdane is over 100 km each way via the Zarzis causeway or ferry.  
  *Recommended Default:* Model an optional per-area `delivery_days` setting in `delivery_zones` (e.g. `"TUE,FRI"`), **defaulting to OFF / ALL DAYS**. When configured, the ordering page informs the customer of the next scheduled delivery day for their area.  
  *Impact if Wrong:* If left off, the owner manually agrees on a delivery date during telephone confirmation.

- **Q3: What is the exact fiscal TVA rate on delivery fees once fees are non-zero?**  
  *Code Reality:* `server/routes/sales.ts:332` hardcodes `tva_rate = 0.19`. All prices are 19% tax-inclusive.  
  *Recommended Default:* Currently, delivery fees are **0.000 DT** so no tax is calculated. When fees are activated, treat the fee as a standard quick-add service line item subject to 19% tax-inclusive rate until the owner's accountant instructs otherwise.

---

## 2. Architecture & Security Isolation

### 2.1 Component Architecture & Trust Boundaries

```
==================================================================================================
                                    AL JAZIRA ERP HOST (El May, Djerba)
==================================================================================================

  [ UNTRUSTED PUBLIC INTERNET ]                   [ TRUSTED OPERATOR ZONE ]
  Clients & Resellers via deSEC                   Owner Devices on Tailnet Only
               |                                                |
               v                                                v
    +----------------------+                         +----------------------+
    |  Router WAN: 80/443  |                         |   tailscale serve    |
    | (Port forward to PC) |                         |  (port 3000 only)    |
    +----------------------+                         +----------------------+
               |                                                |
               v                                                |
    +----------------------+                                    |
    |   Caddy Web Server   |                                    |
    | (Dedicated user:     |                                    |
    |  caddy, bound to LAN)|                                    |
    | TLS (HTTP-01 / ALPN) |                                    |
    | Proxies /public/ &   |                                    |
    | /order* only; 404 all|                                    |
    +----------------------+                                    |
               |                                                |
      Reverse Proxy ONLY to:                                    |
         127.0.0.1:3001                                   127.0.0.1:3000
               |                                                |
               v                                                v
    +-----------------------+                        +-----------------------+
    |  publicApp (Express)  |                        |   adminApp (Express)  |
    |                       |                        |                       |
    | - /public/api/catalog |                        | - /api/sales          |
    | - /public/api/orders  |                        | - /api/register       |
    | - /public/api/auth    |                        | - /api/accounting     |
    | - Serves dist-order/  |                        | - /api/backups        |
    | - Strict Rate Limits  |                        | - Serves admin dist/  |
    | - Payload limit: 64KB |                        | - Exact CORS list     |
    | - trust proxy: loopback                        | - No server login     |
    | - Synchronous handlers|                        +-----------------------+
    +-----------------------+                                   |
               \                                                /
                \                                              /
                 \        +----------------------------+      /
                  ------> |  Data Access Layer (DAL)   | <----
                          |  - Prepared Statements     |
                          |  - Parameterized Queries   |
                          +----------------------------+
                                        |
                                        v
                          +----------------------------+
                          |   SQLite (data/erp.sqlite) |
                          |   WAL Mode, busy_timeout   |
                          +----------------------------+
```

### 2.2 Honest Isolation Assessment: Boundaries & Shared Realities

1. **Shared Node.js Event Loop:** `adminApp` and `publicApp` run in the same single-threaded Node.js event loop.
2. **Synchronous Database Engine:** `better-sqlite3` is a synchronous, blocking SQLite driver. Any query on `publicApp` blocks the Node thread until SQLite returns. Slow scans on `publicApp` will pause POS scanning.
3. **Shared Process Crash Domain:** An unhandled exception or native addon crash originating in `publicApp` terminates the entire Node process, crashing the in-store POS register.
4. **Shared SQLite File & WAL:** Concurrent writes from order placement and in-store checkouts compete for SQLite's single write lock.
5. **Backups Reality:** The existing backup routes (`/api/backups`) copy the entire SQLite database file (`data/erp.sqlite`). Therefore, backups necessarily contain database records, including salted scrypt password hashes and customer data. They do **not** contain the session signing secret, which is kept outside SQLite in an environment variable or root-only file. Backups are protected by:
   - Admin routes only accessible via Tailscale tailnet (`127.0.0.1:3000`).
   - Strict operating system filesystem permissions (`chmod 700 backups/` and `data/backups/`).

### 2.3 Concrete Mitigations for Shared Domain Risks & Error Containment

1. **Synchronous Handlers & Promise Wrapping (Express 4.21 Compatibility):**  
   Express 4.21 does **not** catch unhandled promise rejections in `async` route handlers. All `publicApp` route handlers must either:
   - Be purely **synchronous** functions utilizing `better-sqlite3`'s synchronous API directly, or
   - Be wrapped in an explicit `asyncHandler` wrapper:
     ```typescript
     export const asyncHandler = (fn: express.RequestHandler): express.RequestHandler => 
       (req, res, next) => {
         Promise.resolve(fn(req, res, next)).catch(next);
       };
     ```
2. **Process-Level Crash Containment:**  
   Add process handlers at startup in `server/index.ts`:
   ```typescript
   process.on('unhandledRejection', (reason, promise) => {
     console.error('[Unhandled Rejection at]', promise, 'reason:', reason);
     // Log-only: do not exit, preserve running POS process
   });
   process.on('uncaughtException', (err) => {
     console.error('[Fatal Uncaught Exception]', err);
     // Node state is undefined/corrupted: log and exit(1); systemd will cleanly restart
     process.exit(1);
   });
   ```
3. **Strict Request Size & Timeouts:**  
   `publicApp` enforces `express.json({ limit: '64kb' })` (admin has 10MB) and a 5-second socket timeout.
4. **Process Supervision:**  
   Supervised by `systemd` (`jazira-erp.service`) with `Restart=always` and `RestartSec=2s`.
5. **POS Latency Benchmark Plan (`npx` only):**  
   Run `npx autocannon -c 50 -d 10 http://127.0.0.1:3001/public/api/catalog` while executing POS checkouts on `http://127.0.0.1:3000/api/sales`. POS latency must stay under 50 ms.

### 2.4 Reseller One-Time Activation Flow & Authentication Hardening

Reseller 4-digit PINs and static owner-issued secrets are **eliminated**. Authentication is managed via a one-time activation code flow:

1. **Phone Normalization & Source of Truth:**  
   - `customers.phone` is the sole source of truth.
   - All phone inputs are normalized to 8 digits (e.g. `normalizePhone(raw) = raw.replace(/\D/g, '').replace(/^(216|00216)/, '').slice(-8)`).
   - In ERP backoffice: when owner clicks **« Activer Espace Revendeur »**, the server validates:
     - `customers.phone` is present and valid 8 digits.
     - The normalized phone is unique: no other active customer in `customers` shares this normalized number. If shared or missing, activation is refused with HTTP 400 (*« Numéro de téléphone manquant ou déjà associé à un autre compte client. »*).

2. **Separate Salts for Activation Code & Password:**  
   The credentials table `customer_auth_credentials` stores two distinct cryptographic salts:
   - `activation_code_salt TEXT NOT NULL`: Random 16-byte hex salt generated when the owner initiates activation.
   - `password_salt TEXT`: NULL until the reseller creates their password, then populated with a fresh random 16-byte hex salt.

3. **Account Creation & Code Generation in ERP Backoffice:**
   - Owner opens customer card in ERP (`type: 'RESELLER'`) and clicks **« Activer Espace Revendeur »**.
   - Server generates an unguessable 8-character alphanumeric activation code (e.g. `J7K9-M2P4`).
   - Server computes `activation_code_hash = crypto.scryptSync(code, activation_code_salt, 64).toString('hex')`.
   - Code expires after 7 days: `activation_expires_at = now + 7 days`.
   - **Shown Once:** Displayed in an ERP modal with a *« Copier le code »* button. Destroyed from memory once closed; owner can never view it again.

4. **Reseller Portal Activation (`/order/activate`):**
   - Reseller opens portal and enters phone number, activation code, and chosen password (min 8 characters, must not equal phone number).
   - Input phone is normalized to 8 digits before lookup.
   - **Unified Generic Error Response & Timing Equalization:**  
     To prevent account enumeration and timing attacks:
     - If the phone does not exist in `customers`, or `type != 'RESELLER'`, or code is wrong, or code is expired (`activation_expires_at < now`), or code is already burned (`activation_code_hash IS NULL`):  
       The server executes a dummy `crypto.scryptSync('dummy_secret', 'dummy_salt_16b!', 64)` and returns the **identical generic error response** (HTTP 400):  
       `{"error": "Code invalide ou expiré. Contactez le magasin."}`
   - **Burning the Code & Storing Password:**  
     Upon successful verification:
     - Generate random 16-byte `password_salt`.
     - Hash password: `password_hash = crypto.scryptSync(password, password_salt, 64).toString('hex')`.
     - Burn code and activate: `activation_code_hash = NULL`, `activation_expires_at = NULL`, `is_activated = 1`.
   - Activation attempts use progressive backoff keyed on **`(normalized_phone + ':' + client_ip)`**.

5. **Owner Password Reset Flow (« Réinitialiser »):**
   - Owner clicks **« Réinitialiser Espace Revendeur »** in customer card.
   - Generates new 7-day activation code and fresh `activation_code_salt`.
   - Clears existing password: `password_hash = NULL`, `password_salt = NULL`, `is_activated = 0`.
   - Increments `session_version = session_version + 1`, **immediately invalidating all active sessions/cookies**.
   - Resets `failed_attempts = 0` and `locked_until = NULL`.
   - Displays new one-time activation code once to the owner.

6. **Reseller Login (`/order/login`):**
   - Credentials: Phone number (normalized) + reseller-chosen password.
   - If phone not found or not activated: run dummy scrypt, return HTTP 401 `{"error": "Identifiants incorrects"}`.
   - If password incorrect: return identical HTTP 401 `{"error": "Identifiants incorrects"}`.
   - Progressive backoff on `(customer_id, client_ip)`: 3 fails $\rightarrow$ 1 min; 5 fails $\rightarrow$ 15 min; 10+ fails $\rightarrow$ 60 min.
   - For unknown phone: progressive backoff keyed on `normalized_phone + ':' + client_ip`.
   - Remembered-device cookie `aljazira_trusted_device` allows legitimate reseller device access during remote IP attacks.
   - Global limit: Max 20 attempts per 10 minutes per IP.

7. **Reseller Credit Exposure Policy (`customers.credit_limit`):**
   - `customers.credit_limit` is a nullable column (`REAL DEFAULT NULL`), configurable in the customer card.
   - **Total Credit Exposure Definition:**
     $$\text{Credit Exposure} = \sum_{\substack{\text{unpaid tickets} \\ \text{status} \neq \text{'PAID'}}} \text{remaining\_amount} + \sum_{\substack{\text{open orders: NEW..OUT\_FOR\_DELIVERY} \\ \text{payment\_preference} = \text{'CREDIT\_ACCOUNT'}}} \text{total\_ttc}$$
   - **At Checkout in the Reseller Portal:**
     - If `customer.credit_limit IS NOT NULL` and `credit_exposure + new_order_total > customer.credit_limit`:
       - The portal **blocks** credit checkout (`CREDIT_ACCOUNT`) with error:  
         *« Limite de crédit dépassée (Encours total : X.XXX DT, Commande : Y.XXX DT, Limite : Z.XXX DT). Veuillez régler vos impayés ou choisir le paiement à la livraison en espèces. »*
       - The portal prompts the reseller to select **Cash on Delivery (`CASH_ON_DELIVERY`)**.
     - If `customer.credit_limit IS NULL`: no automated ceiling is enforced; the order can be placed on credit.
     - An optional telephone call confirmation threshold is maintained via `settings.key = 'credit_call_threshold'` (default e.g. 200.000 DT).
   - **At Delivery Conversion in the ERP:**
     - When the owner converts an order with credit payment, the system recalculates current credit exposure.
     - If credit exposure exceeds `customer.credit_limit`, the system displays an **owner warning banner/alert** in the conversion modal. It does **NOT** hard block the owner, preserving managerial authority to authorize exceptions.

8. **Confidentiality & Anti-Leakage Invariants:**
   - Plaintext passwords and codes are never stored.
   - Session signing secret (`PUBLIC_SESSION_SECRET`) is stored strictly outside SQLite in process environment variables or a root-only file (`/etc/jazira/session.secret`, `chmod 600`), never inside the database.
   - Database dumps and backups contain salted scrypt hashes and are protected by Tailscale tailnet access and folder permissions (`chmod 700 backups/`).
   - Customer APIs (`GET /api/customers`, `GET /api/customers/:id`) and settings APIs (`GET /api/settings`) **never return** `password_hash`, `activation_code_hash`, `activation_code_salt`, `password_salt`, or `public_session_secret`.
   - CSRF Defense: Custom header `X-Requested-With: JaziraOrder` required on state-changing endpoints.

---

## 3. Exposure Architecture: deSEC Dynamic DNS, Port Forwarding & Caddy

### 3.1 Primary Architecture: deSEC + Port Forward + Local Caddy

1. **Caddy vs. Tailscale Serve Port 443 Conflict & Verification:**
   - *Conflict:* Both Caddy and `tailscale serve` running on the same host may attempt to bind `:443`.
   - *Architecture:* Configure Caddy's site block to explicitly bind to the local physical LAN IP (`bind {$LAN_IP}`). Caddy will not listen on `0.0.0.0` or collide with `tailscale0`.
   - *Verification Step:* Run `ss -tulpn | grep -E ':(80|443)\b'` before launching Caddy to verify socket ownership. Configure a static DHCP reservation on the router (e.g. `192.168.1.50`) for the shop PC.

2. **Secure deSEC Dynamic IP Update (No Token in URL):**
   - Place credentials in a root-only configuration file `/etc/desec/desec.conf` (`chmod 600`, `chown root:root`):
     ```
     user = "<host>.dedyn.io:<desec-token>"
     ```
   - A `systemd` timer runs every 5 minutes executing:
     ```bash
     curl -s --config /etc/desec/desec.conf "https://update.dedyn.io/"
     ```

3. **Caddyfile Configuration (Cleaned & Minimal):**
   - Caddy runs natively under a dedicated system user (`caddy`).
   - Automatically obtains Let's Encrypt certificates via **HTTP-01** (port 80) or **TLS-ALPN-01** (port 443).
   - Redirects `/` directly to `/order` with **HTTP 302 Found** (`redir / /order 302`), preventing permanent browser cache trapping during maintenance or configuration changes.
   - Proxy rules route `/public/*` and `/order*` to `publicApp` on port 3001, and respond 404 to all other traffic:
     ```caddy
     {$PUBLIC_ORDER_DOMAIN} {
         bind {$LAN_IP}

         header {
             X-Content-Type-Options nosniff
             X-Frame-Options DENY
             Referrer-Policy strict-origin-when-cross-origin
         }

         # Redirect root to ordering portal (302 temporary redirect)
         redir / /order 302

         # Proxy public ordering routes
         handle /public/* {
             reverse_proxy 127.0.0.1:3001 {
                 header_up Host {host}
                 header_up X-Real-IP {remote_host}
                 header_up X-Forwarded-For {remote_host}
                 header_up X-Forwarded-Proto {scheme}
             }
         }

         handle /order* {
             reverse_proxy 127.0.0.1:3001
         }

         # Catch-all: 404 for all other paths (including all admin /api/* routes)
         handle {
             respond "Page introuvable" 404
         }
     }
     ```

4. **Router Hardening & Host Firewall:**
   - Forward ports **80** and **443** to the shop PC's LAN IP.
   - Disable **UPnP** and **Remote WAN Management** on the router.
   - UFW firewall on host: Inbound external interface allows only ports `80` and `443`. Ports `3000` and `3001` bind strictly to loopback `127.0.0.1`.
   - Backup directory permissions: `chmod 700 backups/` and `data/backups/`. The user running Caddy cannot access SQLite files or backups.

5. **Owner Mobile Verification Checklist (from 4G data outside shop Wi-Fi):**
   1. `curl -I https://<host>.dedyn.io/` $\rightarrow$ Must return `302 Found` with `Location: /order`.
   2. `curl -I https://<host>.dedyn.io/public/api/health` $\rightarrow$ Must return `200 OK`.
   3. `curl -I https://<host>.dedyn.io/api/sales` $\rightarrow$ Must return `404 Not Found`.
   4. `curl -I https://<host>.dedyn.io/api/register/current` $\rightarrow$ Must return `404 Not Found`.
   5. `curl -I https://<host>.dedyn.io/api/backups` $\rightarrow$ Must return `404 Not Found`.
   6. `curl -I https://<host>.dedyn.io:3000` $\rightarrow$ Must time out / Connection Refused.
   7. `curl -I https://<host>.dedyn.io:3001` $\rightarrow$ Must time out / Connection Refused.

### 3.2 Comparison of Exposure Options

| Attribute | Primary: deSEC + Port Forward + Caddy | Fallback 1: WireGuard to Owner's Server | Fallback 2: Tailscale Funnel |
| :--- | :--- | :--- | :--- |
| **Architectural Complexity** | Low (direct to shop Caddy) | Medium (WireGuard tunnel + remote proxy) | Minimal (Tailscale CLI daemon) |
| **Monthly Cost** | **0.000 DT** (deSEC is free non-profit) | Existing server cost | **0.000 DT** (Free tier) |
| **Shop IP Revealed?** | **YES** (A record resolves to WAN IP) | **NO** (Only WireGuard server IP shown) | **NO** (Tailscale relay IP shown) |
| **Port Conflicts** | Solved by `bind {$LAN_IP}` | Uses remote server ports | Conflict risk with `tailscale serve` |
| **ISP Dependency** | Requires router port-forwarding | Works behind any NAT/firewall | Works behind any NAT/firewall |
| **Offline Behavior** | Browser connection timeout | Remote proxy serves static offline page | Tailscale 502 error page |

---

## 4. Data Model & Order State Machine

### 4.1 New Database Tables & Schema Additions (Zero Seed Rows)

Added inside `server/db/index.ts` via SQLite schema migration. **No seed rows and no hardcoded dates** are included:

```sql
-- 1. Delivery Zones (Configured by the owner in ERP settings)
CREATE TABLE IF NOT EXISTS delivery_zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,                     -- e.g. "Djerba", "Zarzis", "Medenine", "Ben Guerdane"
    min_order_amount REAL NOT NULL DEFAULT 0.000, -- in TND (3 decimals)
    delivery_fee REAL NOT NULL DEFAULT 0.000,      -- in TND (3 decimals)
    delivery_days TEXT,                     -- NULL or "ALL", or "TUE,FRI"
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

-- 2. Reseller Web Credentials & One-Time Activation (Separate Salts)
CREATE TABLE IF NOT EXISTS customer_auth_credentials (
    customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    activation_code_hash TEXT,              -- scrypt hash of single-use activation code (NULL when burned)
    activation_code_salt TEXT NOT NULL,     -- 16-byte random hex salt for activation code
    activation_expires_at TEXT,             -- ISO timestamp (7 days from issue, NULL when burned)
    password_hash TEXT,                     -- scrypt hash of reseller-chosen password (NULL until activated)
    password_salt TEXT,                     -- 16-byte random hex salt for password (NULL until activated)
    is_activated INTEGER NOT NULL DEFAULT 0,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,                      -- ISO timestamp for progressive backoff
    session_version INTEGER NOT NULL DEFAULT 1, -- increments to invalidate sessions
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 3. Client Orders
CREATE TABLE IF NOT EXISTS client_orders (
    id TEXT PRIMARY KEY,                    -- "ord-UUID"
    order_number TEXT UNIQUE NOT NULL,      -- "ORD-YYYYMMDD-XXXX"
    source TEXT NOT NULL CHECK (source IN ('RESELLER_PORTAL', 'PUBLIC_WEB', 'MANUAL_ENTRY')),
    customer_id TEXT REFERENCES customers(id) ON DELETE RESTRICT, -- NULL for public guest
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    delivery_address TEXT NOT NULL,
    delivery_zone_id TEXT NOT NULL REFERENCES delivery_zones(id),
    subtotal_ttc REAL NOT NULL,             -- in TND (3 decimals)
    delivery_fee REAL NOT NULL DEFAULT 0.000, -- in TND (3 decimals)
    total_ttc REAL NOT NULL,                -- in TND (3 decimals)
    payment_preference TEXT NOT NULL CHECK (payment_preference IN ('CASH_ON_DELIVERY', 'CREDIT_ACCOUNT')),
    loan_containers_requested INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    status TEXT NOT NULL CHECK (status IN ('NEW', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED')),
    cancellation_reason TEXT,
    sale_id TEXT UNIQUE REFERENCES sales(id) ON DELETE SET NULL, -- populated on conversion
    idempotency_key TEXT UNIQUE NOT NULL,
    access_token TEXT UNIQUE NOT NULL,      -- 64-hex token for guest tracking
    delivered_by TEXT,                      -- Nullable hook for future delivery personnel
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 4. Client Order Items (Clean Quantity Schema: No Redundant Column)
CREATE TABLE IF NOT EXISTS client_order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES client_orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    pack_size_id TEXT REFERENCES product_pack_sizes(id),
    container_type_id TEXT REFERENCES container_types(id), -- Specific container loaned per line
    ordered_quantity REAL NOT NULL,         -- Quantity originally ordered
    delivered_quantity REAL,                -- Quantity physically delivered (NULL until conversion; 0 = refused)
    pack_multiplier INTEGER NOT NULL DEFAULT 1,
    unit_price_ttc REAL NOT NULL,           -- Price agreed/quoted at order submission
    catalog_unit_price_snapshot REAL,       -- Current catalog price at conversion time
    line_total_ttc REAL NOT NULL,
    notes TEXT
);

-- 5. Credit Limit Column on Customers (Phase 1a Scope)
-- ALTER TABLE customers ADD COLUMN credit_limit REAL DEFAULT NULL;

-- 6. Product Online Visibility Flag
-- ALTER TABLE products ADD COLUMN online_orderable INTEGER NOT NULL DEFAULT 0;

-- Indices
CREATE INDEX IF NOT EXISTS idx_client_orders_status ON client_orders(status);
CREATE INDEX IF NOT EXISTS idx_client_orders_customer ON client_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_client_order_items_order ON client_order_items(order_id);
```

### 4.2 Order Status State Machine & Document Flow

```
                      [ Customer Submits Order / Owner Manual Entry ]
                                             |
                                             v
                                          +-----+
                                          | NEW |
                                          +-----+
                                           /   \
                       Owner cancels /    /     \  Owner confirms via phone
                     customer cancellation       \ (can edit items/quantities)
                                       v         v
                                +-----------+  +-----------+
                                | CANCELLED |  | CONFIRMED |
                                +-----------+  +-----------+
                                                     |
                                                     | Production / packaging
                                                     v
                                               +-----------+
                                               | PREPARING |
                                               +-----------+
                                                     |
                                                     | Generates Preparation Slip
                                                     | (Fiche de Préparation)
                                                     v
                                           +------------------+
                                           | OUT_FOR_DELIVERY |
                                           +------------------+
                                                     |
                                                     | Delivery at door, cash collected,
                                                     | containers returned, refused items adjusted
                                                     v
                                               +-----------+
                                               | DELIVERED | ===> [ Converts to SALE via createSale() in ONE Outer Tx ]
                                               +-----------+      [ Generates legal Delivery Note (BL) ]
```

### 4.3 Transitions & Permitted Actors

| From State | To State | Trigger / Actor | Invariants & Side Effects |
| :--- | :--- | :--- | :--- |
| *(None)* | **`NEW`** | Reseller, Guest, or Owner (Manual Entry) | Total verified $\ge$ zone minimum order. Reseller credit exposure verified (`exposure + order <= credit_limit`). No stock deducted. Honeypot check passed. |
| **`NEW`** | **`CONFIRMED`** | Owner (ERP) | Owner calls customer. **Owner can edit line items/quantities via `PUT /api/orders/:id`**. |
| **`NEW`** | **`CANCELLED`** | Owner or Customer | Reason recorded. No stock or financial impact. |
| **`CONFIRMED`** | **`PREPARING`** | Owner (ERP) | Detergent batches formulated and packaged in shop. |
| **`PREPARING`** | **`OUT_FOR_DELIVERY`**| Owner (ERP) | Generates **Preparation Slip / Fiche de Préparation**. **No BL created yet** (preserves `delivery_notes.sale_id NOT NULL`). |
| **`OUT_FOR_DELIVERY`** | **`DELIVERED`** | Owner (ERP Mobile/Desktop) | **Atomic conversion via shared `createSale()` inside ONE outer database transaction**: items with `delivered_quantity = 0` omitted from sale, stock decremented, receipt number assigned, `delivery_notes` created, register cash updated in dedicated "Livraison" session, container returns processed via `recordContainerTransaction`. Failure at any step rolls back everything. |
| **`OUT_FOR_DELIVERY`** | **`CANCELLED`** | Owner (ERP) | Customer unreachable or refused entire delivery. Preparation slip voided. No sale created. |

### 4.4 Order Editing at CONFIRMED & Doorstep Refusals

1. **Owner Order Editing (`PUT /api/orders/:id`):**
   - Permitted when status is `NEW` or `CONFIRMED`.
   - Allows modifying quantities, adding/removing products, adjusting notes, or updating the delivery zone.
   - Recalculates each line total, subtotal, delivery fee, and total TTC.
2. **Doorstep Refusals & Partial Delivery:**
   - If a customer refuses an item at delivery (e.g. ordered 4 jerrycans, accepts only 2, or refuses an item completely):
   - The delivery conversion modal in the ERP presents editable `delivered_quantity` inputs.
   - The owner inputs `delivered_quantity = 2` (or `0` for completely refused items).
   - In `client_order_items`, `ordered_quantity = 4` and `delivered_quantity = 2` (or `0`) are recorded for audit history.
   - `createSale()` is invoked **strictly with lines where `delivered_quantity > 0`**. Lines with `delivered_quantity = 0` are completely omitted from the resulting sale.

---

## 5. Order -> Sale Conversion Workflow

### 5.1 Phase 0: Verbatim `createSale(db, input)` Extraction & Sync Debt Boundary

To eliminate regression risks, the entire in-store sale creation engine currently inline inside `server/routes/sales.ts:341-760` is **moved verbatim** into `server/services/saleService.ts` as:

```typescript
export interface CreateSaleInput {
  session_id: string; // Already resolved, non-null, open session
  customer_id?: string | null;
  date?: string;
  items: Array<{
    product_id?: string | null;
    is_quick_add?: boolean;
    quick_add_name?: string | null;
    name?: string;
    description?: string;
    pack_size_id?: string | null;
    quantity: number | string;
    unit_price: number | string;
    discount_amount?: number | string;
    loan_container?: boolean;
    container_type_id?: string | null;
  }>;
  total_discount?: number | string;
  cash_paid?: number | string;
  cash_tendered?: number | string;
  wallet_paid?: number | string;
  credit_amount?: number | string;
  synced_from_client_id?: string | null;
}
```

#### Verbatim Logic Moved into `createSale`:
1. **Item Validation & Processing:**
   - Validates `quantity > 0` and `unit_price >= 0` and non-negative line discounts.
   - Enforces quick-add rules (requires name, `base_stock_deducted = 0`).
   - For catalog items: validates `product_id` exists in `products`.
   - Validates `pack_size_id` belongs to the product, computes `packMultiplier`, and computes `base_stock_deducted = qty * packMultiplier` **internally inside the service** (never trusted from the caller).
   - Computes `catalogUnitPrice` via `computeExpectedCatalogPrice()`.
   - Sets deviation flag: `overridden = round3(unitPrice) !== round3(catalogUnitPrice)`.
   - Enforces: `loan_container requires a selected customer`.
2. **Open Session Enforcement:**
   - Validates that the supplied `session_id` exists and is `OPEN`. An open register session is **mandatory** for finalizing any sale.
   - *(Note: `salesRouter.post('/')` retains its caller-level session alias `session_id || register_session_id || fallback_latest_open`, and passes the resolved non-null `session_id` into `createSale`)*.
3. **Payment Validation:**
   - Calls `validateSalePayment` (`server/utils/payments.ts`) to enforce payment sum equality, change calculation, and non-negative tenders.
   - Enforces strict wallet balance pre-check and credit customer requirement.
4. **Transaction & Concurrency Retry Loop:**
   - Decrements wallet balance inside transaction (`WHERE wallet_balance >= ?`).
   - Decrements physical stock (`stock_quantity = stock_quantity - ?`).
   - Inserts sale record and sale items.
   - Creates FIFO debt ticket if credit is used.
   - Container loans: calculates needed jerrycans using `calculateContainersNeeded`, logs `container_transactions` (`GIVE`, notes: `Prêt consigne vente ${receiptNumber}`), decrements shop container stock, upserts `customer_container_loans`.
   - **Collision Retry Loop:** Wraps execution in up to 3 attempts catching `isUniqueViolation(err)`. On clash, regenerates `receiptNumber = generateReceiptNumber(db)`, clears partial collectors, and retries.
5. **Exact Response Shape Returned:**
   Returns the exact object expected by the frontend and existing POS tests (including `open_cash_drawer`, `should_kick_drawer`, `debt_ticket`, `container_loans`, `items`, and mirrored `sale`).

#### Note on `server/routes/sync.ts` Sale Duplication (Known Technical Debt):
`server/routes/sync.ts:~362` has its own separate inline `INSERT INTO sales` and item insertion logic for offline client synchronization. **Phase 0 leaves `sync.ts` untouched**, recording this duplication as known technical debt. We do **not** claim a single unified sale engine across the entire codebase. Section 11 includes a drift detection test asserting that the schema and columns inserted by `sync.ts` match `createSale()`.

### 5.2 Parity Test Plan for Step 0 Refactor

Before writing any order conversion logic:
1. Capture snapshot JSON responses of `POST /api/sales` across all standard POS test scenarios (cash, split tender, wallet, credit, pack sizes, container loans).
2. Refactor `salesRouter.post('/')` to call `createSale(db, req.body)` and map thrown service errors to HTTP status codes (400, 404).
3. Execute `npx vitest run`. All 65 existing test files (535 tests) must pass with zero regressions.

### 5.3 Order-to-Sale Conversion Execution: Single Outer Transaction & Counter Targeting

When the owner completes a delivery and executes conversion in the ERP:

1. **Full Payment Breakdown in Request:**  
   The conversion endpoint `POST /api/orders/:id/convert` requires:
   ```typescript
   {
     register_session_id: string,
     delivered_items?: Array<{ order_item_id: string; delivered_quantity: number }>,
     cash_paid: number,
     cash_tendered?: number,
     wallet_paid: number,
     credit_amount: number,
     containers_returned?: Array<{ container_type_id: string; quantity: number }>
   }
   ```
   - `client_orders.payment_preference` is strictly a default suggestion; the actual tender is finalized at conversion.
   - **Guest Validation:** If `client_orders.customer_id` is NULL (guest), `wallet_paid` and `credit_amount` must both be 0. Guests cannot pay with credit or wallet.
   - **Partial Delivery / Doorstep Refusals:** If `delivered_items` is provided, `client_order_items.delivered_quantity` is updated. Items with `delivered_quantity = 0` are omitted from the payload passed to `createSale()`.
   - **Credit Exposure Re-check:** If `credit_amount > 0` and `customer.credit_limit` is exceeded, the conversion modal displays an owner warning banner; it does not hard block conversion.

2. **Dedicated "Livraison" Counter Initialization & Session Targeting:**
   - **Idempotent Ensure-Insert:** In `server/db/index.ts`, add an idempotent counter insertion matching lines 109-118:
     ```typescript
     db.prepare("INSERT OR IGNORE INTO counters (id, name, is_active, created_at) VALUES ('counter-delivery', 'Livraison', 1, ?)").run(now);
     ```
   - **Register Session Targeting:** Because `server/routes/register.ts:88` and `register.ts:166` default `counter_name` to `'Countertop'`, the conversion modal in the ERP cannot use register defaults:
     - It queries `GET /api/register/current?counter_name=Livraison`.
     - If no open session exists for `'Livraison'`, the modal prompts the owner to open one (`POST /api/register/open` with `{ counter_name: 'Livraison', opening_cash: ... }`).
     - Order conversion passes this explicit `register_session_id`.

3. **Doorstep Offline Scope (v1 = Strictly Path B):**
   - V1 uses **strictly Path B (Pending Reconciliation / Deferred Conversion)**:  
     At the customer door, the owner hands over goods with the signed Preparation Slip, collects cash, and performs the conversion in the ERP once back in network coverage or at the shop.
   - **Path A (Offline Sync Queue via Dexie) is OUT OF SCOPE for v1:**  
     Routing doorstep conversions through Dexie offline sync would execute through the duplicate `sync.ts` sale insert instead of the verified `createSale()` service, bypassing conversion invariants and risking ledger drift.

4. **Single Outer Database Transaction (`db.transaction`):**  
   The entire conversion workflow executes inside **one single outer database transaction**. Any uncaught exception at any step aborts the entire transaction, rolling back stock, sale record, delivery note, order status, and container transactions:
   ```typescript
   const convertTx = db.transaction(() => {
     // 1. Idempotency check: verify client_orders.sale_id IS NULL and status IN ('CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY')
     // 2. Update delivered_quantity on client_order_items; omit delivered_quantity = 0 from sale items
     // 3. Append delivery fee if > 0 (DELIVERY_FEE_LINE_NAME)
     // 4. Execute createSale(db, saleInput)
     // 5. If containers_returned: execute recordContainerTransaction(db, returnInput)
     // 6. Generate delivery note BL-YYYYMMDD-XXXX (with retry)
     // 7. Update client_orders SET status = 'DELIVERED', sale_id = sale.id
     // 8. Idempotency completed via processed_requests (completeRequest) inside the same transaction
   });
   ```

5. **Doorstep Container Returns via Extracted Service:**  
   Calls `recordContainerTransaction(db, input)` in `server/services/containerService.ts` (extracted from `server/routes/containers.ts:140-237`), reusing `quantity_owed` validation and RETURN-above-owed guards.

6. **Delivery Fee Service Item:** Appends delivery fee (if > 0) as a service item using the shared constant:  
   `{ is_quick_add: true, quick_add_name: DELIVERY_FEE_LINE_NAME, quantity: 1, unit_price: order.delivery_fee }`.

---

## 6. Pricing, Availability & Catalog Drift

### 6.1 Pricing Tier Resolution
Pricing is recalculated on the server using `computeExpectedCatalogPrice(db, product, customer, packSizeId, packMultiplier)`:
- **Reseller:** Wholesale price discounted by `customer.reseller_discount_percent`.
- **Wholesale:** `product.wholesale_price`.
- **Public Retail:** `product.retail_price`.
- Client-submitted prices are completely ignored.

### 6.2 Pricing Snapshot & Catalog Drift Policy
- When an order is placed, the quoted unit price is stored in `client_order_items.unit_price_ttc`.
- At delivery conversion time, `createSale` uses `unit_price_ttc` as the effective `unit_price`, but populates `catalog_unit_price` with the *current* catalog price.
- **Deviation Flag:** If the catalog price was updated between order and delivery, `unit_price !== catalog_unit_price`. The ERP's existing deviation badge alerts the owner in the sales history and receipt view.
- **Commercial Policy:** The price quoted when the customer placed the order is honored.

### 6.3 Coarse Availability Mapping & Copy Rules
Raw stock counts (`stock_quantity`) are never exposed publicly. The public API returns coarse availability:

```typescript
export function toCoarseAvailability(stock: number, threshold: number): 'AVAILABLE' | 'LOW_STOCK' | 'ON_ORDER' {
  if (stock <= 0) return 'ON_ORDER';   // "Sur commande (fabrication en cours)"
  if (stock <= threshold * 2) return 'LOW_STOCK'; // "Stock limité"
  return 'AVAILABLE';                  // "En stock"
}
```

*Availability Copy Invariant:* **No timeframe promises (e.g. "24-48h") are displayed** unless explicitly enabled in `settings.key = 'public_order_lead_time'`. By default, the copy displays strictly: *« Sur commande (fabrication en cours) »*.

### 6.4 Per-Product Online Visibility Flag
Products must not be published to the public portal by default.
- A new column `online_orderable INTEGER NOT NULL DEFAULT 0` is added to `products`.
- The public catalog query filters `WHERE active = 1 AND online_orderable = 1`.
- Products remain completely hidden from the public portal until the owner explicitly enables them in the backoffice product modal.

---

## 7. Delivery Logistics, Fees & Register Reconciliation

### 7.1 Delivery Zones & Minimums

All delivery zones are configured dynamically by the owner in the ERP settings. The table starts empty:

| Area Name | Default Delivery Fee | Default Minimum Order | Default Delivery Days |
| :--- | :--- | :--- | :--- |
| **Configured by Owner** | 0.000 DT | 0.000 DT | ALL (Mon–Sat) |

*(Note: Figures like 30, 50, 70 DT discussed previously are strictly illustrative placeholders. System defaults stay 0.000 DT until the owner enters custom amounts).*

### 7.2 Delivery Fee Modeling in Sales & Server-Side Refund Rejection

- **Shared Constant:**  
  `export const DELIVERY_FEE_LINE_NAME = 'Frais de livraison';`
- **In `sales` & `sale_items`:**  
  Because the `sales` table has no `delivery_fee` column, delivery fees are modeled as a dedicated service line item:  
  `quick_add_name: DELIVERY_FEE_LINE_NAME`, `is_quick_add: 1`, `base_stock_deducted: 0`.  
  *(Note for Owner: Delivery fee revenue will appear under quick-add sales in current sales and category reporting).*
- **Server-Side Refund Rejection on Both Refund Routes:**  
  Delivery transport services rendered cannot be refunded. Inside `processRefund()` (`server/routes/sales.ts`), which backs both:
  - `POST /api/sales/:id/refund`
  - `POST /api/refunds` (with body `{ sale_id, items: [{ sale_item_id, quantity }] }`)
  The server resolves the fee line via the `sale_item_id` referenced in the request body (`SELECT * FROM sale_items WHERE id = ?`). If `saleItem.quick_add_name === DELIVERY_FEE_LINE_NAME`, the server immediately rejects the refund with HTTP 400:  
  `{"error": "Les frais de livraison ne sont pas remboursables."}`

### 7.3 Cash Collection & "Livraison" Register Close Reconciliation

1. Before starting deliveries, the owner opens the **"Livraison"** register session (opening cash e.g. 0.000 DT or change float).
2. At customer doorstep, the owner collects cash and confirms delivery.
3. `createSale()` records `cash_paid` attributed specifically to the "Livraison" session.
4. At evening close, the owner closes the "Livraison" session:
   $$\text{Expected Cash}_{\text{Livraison}} = \text{Opening Cash} + \sum \text{Delivery Cash Paid} + \text{Cash In} - \text{Cash Out}$$
5. The owner transfers physical cash from the delivery pouch to the shop Countertop drawer via a `CASH_IN` movement on Countertop, maintaining pristine drawer accounting.

---

## 8. Security & Abuse Threat Analysis

### 8.1 Threat Matrix

| Attacker & Vector | Targeted Asset | Attack Impact | Concrete Mitigation |
| :--- | :--- | :--- | :--- |
| **Bot / Spam Flooding** | Shop inventory, owner time | Hundreds of fake orders placed. | 1. Rate limits: max 3 orders/2 hrs per phone; looser 10 orders/2 hrs per IP.<br>2. Invisible honeypot field (`website_hp`).<br>3. Mandatory telephone confirmation call before dispatch. |
| **Reseller Credential & Code Brute Force** | Reseller account, credit line | Attacker guesses password or activation code. | 1. Single-use 7-day activation code, scrypt hashed with `activation_code_salt`.<br>2. Reseller chooses password (min 8 chars, != phone), scrypt hashed with separate `password_salt`.<br>3. Progressive backoff keyed on `(customer_id, client_ip)` for activation & login; unknown phones keyed on `(normalized_phone + ':' + client_ip)`.<br>4. Remembered-device cookie prevents locking legitimate reseller.<br>5. Unified generic error response (*« Code invalide ou expiré. Contactez le magasin. »*) and timing equalization with dummy scrypt.<br>6. ERP header alert on locked accounts. |
| **Reseller Credit Limit Evasion** | Shop working capital | Reseller places massive credit orders beyond debt capacity. | `customers.credit_limit` enforcement: portal blocks `CREDIT_ACCOUNT` when `credit_exposure + order > credit_limit`, offering cash on delivery instead. Conversion re-check warns owner without hard block. |
| **Reseller Cross-Account Snooping** | Confidential order history, pricing | Reseller A tries reading Reseller B's orders. | **Ownership enforcement:** `WHERE client_orders.customer_id = req.reseller.customer_id`. Reseller A querying Reseller B's order receives HTTP 404. |
| **Price Tampering in Request** | Profit margins | Attacker alters JSON body prices. | **Client prices are completely discarded.** Server recalculates every item price inside SQLite transactions. |
| **Admin Route Probing** | Admin ERP API, financials, backups | Attacker queries `/api/sales` or `/api/backups` on public domain. | **Caddy catches all non-public paths with 404.** Public Express app does not mount admin routers. |
| **DoS on Single Process** | Shop POS availability | Attacker floods public port 3001. | 1. Payload size capped at 64KB.<br>2. 5-second socket timeout.<br>3. In-memory rate limiting.<br>4. Prepared statements for catalog queries. |
| **Shop IP & Backup Discovery** | ERP database, backups | DNS reveals shop WAN IP. | 1. UFW blocks all ports except 80 and 443.<br>2. Caddy runs as dedicated unprivileged user.<br>3. Directories `backups/` and `data/backups/` set to `chmod 700`.<br>4. Backups are whole SQLite snapshots containing salted scrypt hashes; session secret is stored outside SQLite. Customer and settings APIs never expose secrets or hashes. |

### 8.2 Privacy & Tunisian Law 2004-63 Compliance

*(Note: Data handling policies must be reviewed with a qualified Tunisian legal professional).*
1. **Data Minimization:** Only Name, Phone, and Delivery Address are gathered. No national ID (CIN) is ever requested.
2. **Backups Protection:** Database dumps in `backups/` and `data/backups/` contain personal data. Backup directories are restricted to the local `admin` user (`chmod 700`).
3. **Retention & Deletion Procedure:** If a customer exercises their right to erasure under Law 2004-63, their phone and address are scrubbed from `client_orders` (`customer_name: 'Client anonymisé'`), while financial sales lines remain intact for statutory accounting requirements.

---

## 9. UX & Notification Flow

### 9.1 Reseller Ordering Experience
1. **Activation (`/order/activate`):**  
   - Reseller enters phone number (normalized to 8 digits) and the single-use 8-character activation code provided by the owner.
   - Enters and confirms their chosen password (min 8 characters, != phone).
   - If invalid/expired/unknown, receives single generic error: *« Code invalide ou expiré. Contactez le magasin. »*.
   - Code is burned, account activated, session token issued, redirected to catalog.
2. **Login (`/order/login`):**  
   - Phone number (normalized) + reseller-chosen password. Link: *« Première connexion ? Activer votre compte »*.
3. **Catalog (`/order/catalog`):** Shows customer name, total credit exposure, and credit limit. Displays tier prices with discount % pill. Coarse availability badges (`En stock` / `Sur commande`).
4. **Cart & Delivery (`/order/cart`):** Delivery area selection. Choice of cash on delivery or credit account (credit blocked if `credit_exposure + order > credit_limit`). Container loan requested checkbox.
5. **Order Tracking (`/order/status/:id`):** Live status tracker: Reçue $\rightarrow$ Confirmée $\rightarrow$ En préparation $\rightarrow$ En livraison $\rightarrow$ Livrée. **Strictly scoped to the authenticated reseller**.
6. **Backoffice ERP UX:** Customer card has *« Activer Espace Revendeur »* modal (validates 8-digit unique phone, generates 7-day single-use code shown once with copy button), editable `credit_limit` field, and *« Réinitialiser »* button (clears password, increments `session_version`, generates new code).

### 9.2 Public Customer Ordering Experience
1. **Storefront (`/order`):** Retail TTC prices, product descriptions, coarse stock tags.
2. **Checkout (`/order/checkout`):** Name, Phone (8 digits normalized), Delivery Area dropdown, Address, optional delivery notes. Invisible honeypot field. Clear operating hours notice.
3. **Confirmation (`/order/status/:token`):** Order number badge (`ORD-YYYYMMDD-XXXX`), unguessable 64-hex tracking link, direct click-to-call button.

### 9.3 Notification Architecture (Zero External Cloud / No PII Leakage)
- **Telegram is strictly eliminated** to prevent leaking customer PII.
- **In-Store ERP Notification:**
  - Active ERP top header displays a glowing badge: `[ 🔔 Commandes (1) ]`.
  - Audio chime triggered via HTML5 Web Audio API on new order arrival.
  - Background polling interval: 15 seconds against `/api/orders/pending-count` (or lightweight SSE).
- **Remote Alert (Owner Away from PC):**
  - If remote notifications are configured, the server transmits **strictly non-PII alerts** (e.g. *"Nouvelle commande #ORD-20261018-0004 reçue pour la zone Djerba"*). No customer name, phone, or address is ever transmitted to any third-party push gateway.

---

## 10. Phased Implementation Plan & Scope Boundaries

### Phase 0: Verbatim `createSale` Extraction & Parity Verification
- **Scope:**
  - Extract `createSale(db, input)` from `server/routes/sales.ts` into `server/services/saleService.ts` **verbatim**.
  - Update `salesRouter.post('/')` to resolve session, call `createSale`, and map errors to HTTP responses.
  - Record inline sale insert in `server/routes/sync.ts:~362` as known technical debt; do not claim single unified engine.
  - Run `npx vitest run` and compare snapshot JSON responses across all standard POS test scenarios to ensure 100% field parity.
- **What We Will NOT Build in Phase 0:**
  - No new routes, no new tables, no frontend changes.

### Phase 1a: Internal Order Entry, Customer Credit Limit, Zones Settings, Containers Extraction & Conversion
- **Scope:**
  - Schema migration: `delivery_zones`, `client_orders`, `client_order_items` (clean quantity schema: `ordered_quantity`, `delivered_quantity`), and `customers.credit_limit`.
  - **Backoffice Customer Modal:** Add editable `credit_limit` field (`REAL DEFAULT NULL`, TND with 3 decimals) to customer cards.
  - Idempotent counter initialization: ensure counter `'Livraison'` exists in `server/db/index.ts`.
  - Extract `recordContainerTransaction(db, input)` from `server/routes/containers.ts:140-237` into `server/services/containerService.ts`.
  - **Delivery Zones Settings Screen** (`/backoffice/settings/delivery-zones`) so the owner can configure Djerba, Zarzis, Medenine, Ben Guerdane.
  - Backoffice ERP Orders tab (`/backoffice/orders`) for manual order entry.
  - Preparation Slip printing (`Fiche de Préparation`).
  - **Conversion Endpoint (`POST /api/orders/:id/convert`) in ONE outer transaction:**
    - Resolves explicit `register_session_id` ("Livraison" session).
    - Omits lines where `delivered_quantity = 0`.
    - Re-checks credit exposure and warns owner without hard block.
    - Calls `createSale(db, saleInput)`.
    - Calls `recordContainerTransaction(db, returnInput)` for doorstep returns.
    - Generates delivery note `BL-YYYYMMDD-XXXX`.
    - Updates order status to `DELIVERED`.
  - Server-side delivery fee refund rejection inside `processRefund()` for both `POST /api/sales/:id/refund` and `POST /api/refunds` using `DELIVERY_FEE_LINE_NAME`.
  - **Doorstep Offline Workflow:** Strictly Path B (paper slip + deferred conversion in ERP).
- **Acceptance Checks:**
  - Owner creates delivery zones in settings.
  - Owner enters order manually; prints Preparation Slip.
  - Owner converts order to sale; stock decrements, cash credits "Livraison" session, debt ticket created if credit.
  - Downstream conversion failure rolls back the entire outer transaction.
- **What We Will NOT Build in Phase 1a:**
  - No public listener, no Caddy, no dynamic DNS, no customer-facing web pages, no Dexie offline sync queue for conversions.

### Phase 1b: Public Listener, Caddy, deSEC & Reseller Portal
- **Scope:**
  - Second Express listener (`publicApp`) on port `3001` with `trust proxy: 'loopback'` and synchronous/wrapped handlers.
  - `PUBLIC_SESSION_SECRET` loaded from environment or root-only file `/etc/jazira/session.secret`.
  - Schema migration: `customer_auth_credentials` (separate salts: `activation_code_salt`, `password_salt`, `session_version`) and `products.online_orderable`.
  - Caddy configuration with `bind {$LAN_IP}`, `/` 302 redirect to `/order`, and deSEC dynamic DNS systemd timer using Basic Auth in `/etc/desec/desec.conf`.
  - Reseller web UI (Activation `/order/activate` with 8-digit phone normalization, generic error, and dummy scrypt spy verification, Login, Catalog, Cart with total credit exposure check, Tracking).
  - Backoffice ERP Reseller Activation modal (validates phone presence and uniqueness).
- **Acceptance Checks:**
  - Owner activates reseller in ERP; phone is validated, single-use code is generated and shown once.
  - Reseller activates on portal, sets password (min 8 chars, != phone); code is burned.
  - Reseller logs in with phone + password, sees tier discount.
  - Reseller with `credit_exposure + order > credit_limit` is blocked from credit and offered cash.
  - Reseller A cannot read Reseller B's order.
  - Verification checklist from mobile data passes (admin routes return 404, root 302 redirects to `/order`).

### Phase 2: Public Guest Retail Ordering & Anti-Bot Hardening
- **Scope:**
  - Public retail guest checkout with honeypot and phone-keyed rate limits (8-digit normalized).
  - Coarse stock availability indicators without timeframe promises.
  - Operating hours banner and out-of-hours queueing.

---

## 11. Concrete Test Plan

A dedicated test suite (`server/routes/clientOrders.test.ts`) must assert the following behaviors:

1. **Phase 0 Parity & Snapshot Verification:**  
   Compare snapshot JSON responses of `POST /api/sales` before and after extracting `createSale()`. All 65 existing test files must pass identically.
2. **Expired / Burned / Invalid Activation Code Single Generic Error:**  
   Submitting an activation code that is expired (`activation_expires_at < now`), already burned (`activation_code_hash IS NULL`), wrong, or for an unknown phone returns HTTP 400 with the identical single generic French error:  
   *« Code invalide ou expiré. Contactez le magasin. »*.
3. **Activation Timing Equalization (Spy Assertion):**  
   Assert via `vi.spyOn(crypto, 'scryptSync')` that `crypto.scryptSync` was invoked during failed activation attempts (unknown phone / invalid code) to verify timing equalization without relying on wall-clock measurements.
4. **Wrong Activation Code Backoff:**  
   Repeated failed activation attempts trigger progressive backoff on `(customer_id, client_ip)` matching login rate limits (or `normalized_phone + ':' + client_ip` for unknown phones).
5. **Password Reset Invalidates Existing Sessions:**  
   Owner clicking « Réinitialiser » increments `session_version`, causing existing active session tokens to be rejected immediately with HTTP 401.
6. **Owner Can Never Read Password or Hashes:**  
   Database inspection and API test: passwords and activation codes are one-way scrypt hashed; neither `GET /api/customers/:id` nor any backoffice endpoint returns plaintext passwords, password hashes, or salts.
7. **Secret & Credential Leakage Prevention (APIs Only):**  
   Automated test asserting that customer APIs (`GET /api/customers`, `GET /api/customers/:id`) and settings APIs (`GET /api/settings`) never return `password_hash`, `activation_code_hash`, `activation_code_salt`, `password_salt`, or `public_session_secret`.
8. **Catalog Online Visibility Filter:**  
   Product with `online_orderable = 0` is omitted from `GET /public/api/catalog`, even if `active = 1`.
9. **Reseller Authorization Boundary:**  
   Reseller A querying `GET /public/api/orders/:id` for Reseller B's order receives HTTP 404.
10. **Reseller Credit Exposure Enforcement:**  
    Reseller card with `credit_limit = 500.000 DT`, unpaid debt tickets of `300.000 DT`, and open credit orders (`CONFIRMED`) of `150.000 DT` (total exposure `450.000 DT`): attempting to place a new credit order of `60.000 DT` (total exposure `510.000 DT` > `500.000 DT`) receives HTTP 400 rejecting credit payment and offering cash on delivery.
11. **Doorstep Refusal & Zero Delivered Quantity Omission:**  
    Order with 2 items where Item A has `delivered_quantity = 2` and Item B has `delivered_quantity = 0`: conversion updates `client_order_items`, and passes strictly Item A to `createSale()`. The generated sale contains only Item A; Item B stock is not decremented.
12. **Server-Side Delivery Fee Refund Rejection on Both Refund Routes:**  
    Attempting to refund a converted sale by calling either `POST /api/sales/:id/refund` or `POST /api/refunds` with a line item targeting `DELIVERY_FEE_LINE_NAME` ('Frais de livraison') throws/returns HTTP 400: *« Les frais de livraison ne sont pas remboursables. »*, resolving the fee line via the `sale_item_id` in the request body.
13. **"Livraison" Session Enforcement & Ensure-Insert:**  
    - Database startup creates counter `'Livraison'` idempotently.
    - Attempting to convert an order when the "Livraison" session is closed or passing a closed session ID rejects conversion.
14. **Container Return Service Parity & Guard:**  
    `recordContainerTransaction` rejects RETURN when quantity exceeds `customer_container_loans.quantity_owed` unless `correction = true`. Successful returns decrement customer owed count and increment shop stock.
15. **Double Conversion Idempotency:**  
    Two concurrent POST requests to convert the same order result in exactly one successful sale and one HTTP 409 Conflict.
16. **Public Bundle Isolation Check:**  
    Lint/AST check verifying that `dist-order/` imports zero files from admin components, admin routes, or `authService.ts`.
17. **`sync.ts` Sale Engine Drift Detection:**  
    Test asserting that all columns inserted into `sales` and `sale_items` by `server/routes/sync.ts` match the fields inserted by `createSale()`.
18. **Atomic Conversion Rollback on Downstream Failure:**  
    Simulate failure in delivery note generation or container return inside `POST /api/orders/:id/convert`. Assert that the outer transaction rolls back *completely*: no sale record exists, no stock is decremented, no debt ticket is created, and order status remains unchanged (`OUT_FOR_DELIVERY`).
19. **Receipt-Number Collision Inside Outer Transaction:**  
    Test receipt number collision handling when converting an order inside the outer transaction, asserting that unique constraint clashes on `sales.receipt_number` retry cleanly or handle collision without corrupting transaction state.
20. **Phone Normalization & Uniqueness Enforcement on Activation:**  
    Clicking « Activer Espace Revendeur » refuses activation with HTTP 400 if phone is missing or if another active customer shares the same normalized 8-digit number. Portal lookups normalize phone numbers (e.g. `+216 98 123 456` $\rightarrow$ `98123456`).

---

## 12. Options Considered & Rejected

1. **Exposing Admin ERP on Public Port:**  
   *Rejected:* Catastrophic security breach. The admin ERP has no server-side authentication (client-side PIN only). Exposing port 3000 would expose the entire business to public manipulation.
2. **Doorstep Offline Conversion via Dexie Sync Queue (Path A):**  
   *Rejected for v1:* Routing doorstep conversions through the client-side Dexie offline queue would route sales through the duplicate inline `sync.ts` sale insert instead of the verified `createSale()` service, bypassing conversion invariants and risking ledger drift. V1 strictly uses Path B (paper slip + deferred conversion).
3. **Storing Session Secrets in SQLite:**  
   *Rejected:* Backups copy the entire SQLite file. Storing `public_session_secret` in the database would leak the session signing key into every backup file. Kept strictly in process environment variables or root-only `/etc/jazira/session.secret`.
4. **WhatsApp-Only Ordering:**  
   *Rejected:* Unstructured text messages require manual re-entry into the POS, leading to pricing errors, forgotten container balances, and delayed dispatch.
5. **Cloud E-Commerce (Shopify / WooCommerce / Cloud Node):**  
   *Rejected:* Violates Hard Constraint #2. Introduces recurring monthly fees, dual-database sync conflicts, and fails during local internet outages.
6. **Third-Party Push Notifications (Telegram / Pushover):**  
   *Rejected:* Forwarding customer delivery addresses and phone numbers through external cloud bots violates our privacy policy and Tunisian Law 2004-63.

---

## 13. Open Risks & Failure Modes

1. **Doorstep Offline Mobile Data Gap (Scope: v1 = Strictly Path B):**  
   *Risk:* At rural customer doorsteps in Medenine or Zarzis, mobile 4G reception may be absent, preventing real-time online conversion via Tailscale.  
   *Mitigation:* V1 uses strictly **Path B (Pending Reconciliation / Deferred Conversion)**. The owner hands over goods with the signed Preparation Slip, collects cash, and performs the conversion in the ERP upon returning to coverage or the shop desktop/mobile. Path A is out of scope.
2. **Router Port Forwarding / ISP Blocking:**  
   *Risk:* The router's WAN IP equals public IP today, but the ISP could block inbound ports 80/443 (**UNVERIFIED**).  
   *Mitigation:* Owner tests port forwarding with a simple netcat/curl test from mobile data before installing Caddy. If blocked, fallback to WireGuard or Tailscale Funnel.
3. **Operator Capacity Bottleneck:**  
   *Risk:* Self-ordering across four distant areas (Djerba, Zarzis, Medenine, Ben Guerdane) could overwhelm a single operator who also produces goods and runs the shop counter.  
   *Mitigation:* Enforce conservative daily delivery limits and use the optional per-area delivery days setting.
4. **Public No-Shows at Doorstep:**  
   *Risk:* A retail customer places an order with cash on delivery but is absent when the owner arrives.  
   *Mitigation:* Mandatory telephone confirmation call prior to loading vehicle. Unconfirmed orders are not dispatched.

---

## One-Page Executive Summary

This architecture specifies an in-house client ordering and delivery system designed exclusively for **Société Al Jazira SHSP in El May, Djerba**, serving **Djerba, Zarzis, Medenine, and Ben Guerdane**. It adheres to all core project invariants: **one Node process, one SQLite database, zero cloud hosting, and complete protection of the unauthenticated admin ERP.**

Inside the single Node server process, an isolated Express app (`publicApp`) listens strictly on `127.0.0.1:3001` with `trust proxy: 'loopback'` and synchronous/wrapped handlers. Public traffic enters through a local **Caddy** web server using the owner's **deSEC.io dynamic DNS name** (`<host>.dedyn.io`), bound specifically to the host's LAN IP (`bind {$LAN_IP}`) to prevent port 443 collisions with `tailscale serve`. Caddy terminates Let's Encrypt TLS, temporarily redirects `/` to `/order` via **HTTP 302 Found**, and catches all non-public paths with an immediate 404. Dynamic DNS is updated via systemd using a root-only Basic Auth configuration file, keeping credentials off command-line process tables. Session signing secrets are kept strictly outside SQLite (in environment variables or root-only `/etc/jazira/session.secret`). Full database backups (`/api/backups`) copy the SQLite file containing salted scrypt hashes, protected by Tailscale tailnet isolation and `chmod 700` filesystem permissions.

Crucially, **an order is NOT a sale until delivered**. At dispatch, an internal Preparation Slip accompanies the goods, respecting the database invariant that a legal Delivery Note (`delivery_notes`) cannot exist without an active `sales.id`. When the owner completes the delivery, a shared `createSale()` engine—extracted verbatim from the existing POS code in Phase 0—executes inside **one single outer database transaction** that atomically:
1. Validates full payment breakdown using `validateSalePayment` (guests cannot use credit/wallet).
2. Omits lines where `delivered_quantity = 0` (doorstep refusals) and decrements physical stock for accepted items.
3. Appends delivery fee as a quick-add service line item (`DELIVERY_FEE_LINE_NAME`), which is strictly non-refundable server-side in `processRefund()` across both `POST /api/sales/:id/refund` and `POST /api/refunds`.
4. Generates the legal sequential Delivery Note (`BL-YYYYMMDD-XXXX`) with its existing 3-attempt collision retry loop.
5. Executes doorstep container returns by calling an extracted shared service `recordContainerTransaction()`.
6. Reconciles collected cash directly into the dedicated **"Livraison"** register session (ensured idempotently at startup).
7. Re-checks credit exposure with an owner warning banner if exceeded, without hard blocking the owner. Failure at any step rolls back the entire outer transaction.

Doorstep offline operations in v1 are **strictly Path B (Pending Reconciliation)**: paper slip at the door and manual deferred conversion in the ERP, leaving Dexie offline sync queue out of scope to prevent routing through the duplicate `sync.ts` sale engine.

Resellers activate accounts via a **single-use 7-day activation code** generated in the ERP and shown once to the owner, after validating that the reseller's 8-digit normalized phone number is present and unique. Resellers activate on the portal, choosing their own password (min 8 chars, != phone). Activation failures return **one single generic French error response** (*« Code invalide ou expiré. Contactez le magasin. »*) with dummy scrypt timing equalization (asserted via spy). Passwords and activation codes use **separate cryptographic salts** (`password_salt`, `activation_code_salt`). A nullable `customers.credit_limit` column is added (with input in backoffice Customer Modal in Phase 1a): the portal automatically blocks credit orders when **total credit exposure** (`unpaid debt tickets + open credit orders`) exceeds the limit, offering cash on delivery. Public retail customers check out frictionlessly with honeypot bot defense, coarse stock visibility without timeframe promises (`En stock` / `Stock limité` / `Sur commande`), and clear operating hours notice (Mon–Sat 08:00–17:00). All third-party push services (such as Telegram) are eliminated to protect customer privacy under Tunisian Law 2004-63.

---

## The 5 Decisions the Owner Must Make First

1. **Offline Doorstep Reconciliation Workflow Approval:**  
   *Decision:* For rural deliveries with poor mobile 4G coverage (Medenine, Zarzis), do you approve **Path B** as the official v1 workflow (handing over goods with the signed paper Preparation Slip and completing the digital conversion in the ERP once back in coverage or at the shop), keeping automated offline sync out of scope for v1?
2. **Delivery Fee & Minimum Order Configuration per Area:**  
   *Decision:* The delivery zones table defaults to **0.000 DT** for all areas initially (Djerba, Zarzis, Medenine, Ben Guerdane). The amounts discussed earlier (e.g. 30, 50, 70 DT) were strictly illustrative examples. Do you wish to keep all fees and minimum order amounts at 0.000 DT initially, or do you want to configure specific non-zero minimum orders or delivery fees for distant areas?
3. **Selection of First 5–10 Products to Publish Online (`online_orderable = 1`):**  
   *Decision:* Products remain hidden from the web portal until enabled. Which specific packaged detergent products (e.g. 5L Jerrycans of Liquide Vaisselle, Lessive Liquide, Javel, Assouplissant) do you want published for the initial reseller launch?
4. **Reseller Credit Limit Policy (`customers.credit_limit` vs Call Threshold):**  
   *Decision:* For each reseller customer, should we assign an explicit credit ceiling in their customer card (e.g. 500.000 DT) where the portal strictly blocks credit orders if total credit exposure (unpaid tickets + open orders) exceeds the limit, or do you prefer leaving `credit_limit` empty for certain trusted resellers and relying on the telephone call threshold setting (`credit_call_threshold`, e.g. 200.000 DT)?
5. **Customer Phone Confirmation Policy for Public Guest Orders:**  
   *Decision:* Should every public retail order strictly require a telephone confirmation call before dispatch (recommended default to eliminate fake orders and wasted fuel), or can repeat phone numbers with a proven delivery record bypass the call step?
