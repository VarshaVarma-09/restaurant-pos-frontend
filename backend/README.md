# Restaurant POS API

## Run locally

1. Use Node.js 20 or newer.
2. From `backend/`, run `npm install`.
3. Copy `.env.example` to `.env`; set the Atlas URI, a random `JWT_SECRET` of at least 32 characters, and a unique bootstrap Owner password. Example placeholder secrets are rejected. The bootstrap password is hashed with bcrypt and must be at least 10 characters.
4. In Atlas, create a database user and allow the development/deployment host in Network Access. Atlas replica sets support the multi-document transactions used by orders, KOTs, payments, and migration.
5. Start the API with `npm run dev` and the Vite app from the project root with `npm run dev`. Vite proxies `/api` to `localhost:5000`.

Startup creates model indexes, default restaurant settings, and the bootstrap Owner only when that username does not already exist. It does not create sample tables or menu items by default. Set `SEED_DEFAULT_BUSINESS_DATA=true` only when intentionally creating the built-in demo tables/menu in an empty collection. Never commit `.env`. In production, set `NODE_ENV=production`, configure `CLIENT_ORIGIN`, and serve frontend and API on the same site so the HttpOnly `SameSite=Lax` session cookie is sent.

## Collections

`User`, `Table`, `MenuItem`, `Order`, `Kot`, `Bill`, `Payment`, `AuditEvent`, `Notification`, `StaffProfile`, and `RestaurantSettings` each have their own Mongoose model and collection. Foreign relationships use the frontend's stable string IDs, so existing order/KOT/bill/payment references remain intact. Table names have a normalized sparse unique index for new API-managed records; old migrated records without that key remain intact and are checked case-insensitively on table writes. Audit events and payment records are append-oriented; related status and billing writes use MongoDB transactions.

`RestaurantState` remains available for an explicitly invoked legacy migration only. Server startup and Owner login never migrate legacy records. The frontend reads operational data only from the individual MongoDB collections through authenticated REST APIs; stale browser business state is not loaded or imported. No legacy data is required for normal operation.

## Main API

- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/session` (one-time legacy bearer exchange), `POST /api/auth/logout`
- `GET /api/payments`, `GET /api/audit-events`, `GET /api/notifications`
- `GET /api/tables`, `POST /api/tables`, `PATCH /api/tables/:id`
- `GET /api/menu`, `POST /api/menu`, `PATCH /api/menu/:id`
- `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id` (Manager can list/create/activate Waiters only; Owner manages all roles and account credentials)
- `GET /api/settings`, `PATCH /api/settings` (GST/currency are Owner-only)
- `GET /api/orders`, `POST /api/orders`, `POST /api/orders/:id/items`, `PATCH /api/orders/:id/status`, `PATCH /api/orders/:id/assignment`
- `GET /api/kots`, `PATCH /api/kots/:id/status`, `POST /api/kots/:kotId/items/:lineId/cancellations`
- `GET /api/billing`, `PATCH /api/billing/:orderId/discount`, `PATCH /api/billing/:orderId/status`, `POST /api/billing/:orderId/payments`
- `PATCH /api/notifications/:id/read`, `GET /api/reports/summary`, `GET /api/state` (read-only compatibility projection), `POST /api/migration/browser-state` (Owner-only), `GET /api/health`

Order creation resolves item names/prices from the active catalog. The server calculates bill totals, validates table occupancy, order/KOT transitions, waiter assignments, discounts, payment balances and cash change. Payment writes require an `Idempotency-Key`; reusing a key with a different payment payload returns `409`. Browser JWTs are HttpOnly cookies with `SameSite=Lax`, an allowlisted Origin check for cookie-authenticated writes, and `Secure` in production; existing localStorage bearer tokens are exchanged once and removed. JWTs are signed with HS256, issuer-checked, expiry-checked, and each request reloads the active user from MongoDB. Password changes, account activation changes and logout invalidate prior tokens. Limited report roles do not receive item-level sales aggregates. `/api/health` reports database readiness without exposing connection details.

The React screens now write through individual domain endpoints; there is no whole-state write route. `GET /api/state` composes collections for the existing context and filters returned data by role.

## Migration and tests

- `npm run migrate:legacy` explicitly copies the old `RestaurantState` document without deleting it. It is never run automatically and has not been run against the configured Atlas database as part of this change.
- `npm test` runs HTTP integration tests against a temporary local MongoDB replica set. The first run downloads a MongoDB test binary. The suite covers login, four operational roles, table/menu operations, price-authoritative order creation, KOT transitions, billing, idempotent payments, reconnect persistence, and non-destructive migration.

To run the API against Atlas, configure `backend/.env` first. Tests against the temporary replica set do not verify credentials, network allowlisting, or persistence in the user's Atlas account.

## Production deployment

1. Provision a MongoDB Atlas replica set and a database user scoped to `readWrite` on `restaurant_pos`; allowlist only the deployment host or network required by your hosting provider.
2. Configure backend environment variables in the hosting provider's secret manager: `MONGODB_URI` (targeting `restaurant_pos`), `JWT_SECRET` (random, at least 32 characters), `CLIENT_ORIGIN` (the exact HTTPS frontend origin; comma-separated only if multiple origins are needed), `NODE_ENV=production`, and optionally `PORT`, `MONGODB_SERVER_SELECTION_TIMEOUT_MS`, and `JWT_EXPIRES_IN`. Provide `BOOTSTRAP_OWNER_USERNAME` and `BOOTSTRAP_OWNER_PASSWORD` only for first-time Owner provisioning; startup never overwrites an existing account's password. Keep `SEED_DEFAULT_BUSINESS_DATA` unset in production.
3. From `backend/`, install locked dependencies with `npm ci` and start the API with `npm start`. Startup creates/verifies indexes and required initialization records. The API uses `HttpOnly`, `Secure`, `SameSite=Lax` cookies in production.
4. From the repository root, run `npm ci`, `npm run lint`, and `npm run build`; host the generated `dist/` directory as the frontend. Route `/api` on the same site (or a same-site subdomain) to the backend so the session cookie remains same-site. If the API has a separate origin, set `VITE_API_URL` at frontend build time and set that exact frontend origin in backend `CLIENT_ORIGIN`; cross-site cookie deployment is not supported by the current `SameSite=Lax` cookie policy.
5. Verify `GET /api/health`, sign in with an active account, create real restaurant tables/menu items through the app, and verify a normal order/KOT/payment workflow before accepting live traffic. Do not run the test suite against production: it uses a temporary MongoDB replica set and requires local networking.
