# Restaurant POS API

The Express API serves the React client in `frontend/`. It connects to MongoDB through Mongoose and applies authentication, role permissions and validation at the API boundary.

## Local setup

### Requirements

- Node.js 20.19 or newer, or 22.12 or newer, and npm.
- MongoDB Atlas or another MongoDB replica set. Order, KOT, bill and payment operations use multi-document transactions; a standalone MongoDB server is not sufficient.

From the repository root, install backend dependencies and create a local environment file:

```bash
cd backend
npm ci
cp .env.example .env
```

In Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`. Set the values in `backend/.env`:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection URI. |
| `JWT_SECRET` | JWT signing secret; at least 32 characters. The example value is rejected. |
| `PORT` | API port; defaults to `5000`. |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | Server selection timeout in milliseconds; defaults to `10000`. |
| `JWT_EXPIRES_IN` | Session lifetime; defaults to `8h`. |
| `CLIENT_ORIGIN` | Allowed browser origin(s); local default is `http://localhost:5173`. Comma-separate multiple origins. |
| `BOOTSTRAP_OWNER_USERNAME` | Username for the initial Owner account. |
| `BOOTSTRAP_OWNER_PASSWORD` | Initial Owner password. Startup requires at least 10 characters and rejects the example value. |
| `GEMINI_API_KEY` | Optional server-side key for the Gemini Assistant. |
| `GEMINI_MODEL` | Model identifier required when using the Gemini Assistant. |
| `SEED_DEFAULT_BUSINESS_DATA` | Optional; set to `true` to add six sample tables and four menu items when those collections are empty. |
| `NODE_ENV` | Optional. Set to `production` to enable Secure cookies; production mode also requires `CLIENT_ORIGIN`. |

The bootstrap Owner is created only when both `BOOTSTRAP_OWNER_USERNAME` and `BOOTSTRAP_OWNER_PASSWORD` are set and the normalized username does not already exist. Startup hashes the password with bcrypt and does not replace an existing account's password. The login endpoint accepts passwords up to 128 characters. Choose your own credentials; no demo login is supplied.

Staff account creation accepts passwords of 10–128 characters. The staff password-reset endpoint accepts 8–128 characters and requires matching `password` and `confirmPassword` fields. The separate `PATCH /api/users/:id` endpoint accepts a 10–128 character password when used by an Owner; Managers can only activate or deactivate Waiter accounts through that endpoint.

Startup connects to MongoDB, initializes model indexes and ensures the default restaurant settings exist. It does not create sample tables or menu items unless `SEED_DEFAULT_BUSINESS_DATA=true`. Never commit `.env`.

Start the API from `backend/`:

```bash
npm run dev
```

In a second terminal, start the frontend from `frontend/`:

```bash
cd frontend
npm ci
npm run dev
```

Vite proxies `/api` to `http://localhost:5000`. The frontend uses `/api` by default. For a different API base URL, configure `VITE_API_URL` in `frontend/.env` at build time.

## Data model and persistence

`User`, `Table`, `MenuItem`, `Order`, `Kot`, `Bill`, `Payment`, `AuditEvent`, `Notification`, `StaffProfile` and `RestaurantSettings` each have a Mongoose model and collection. Relationships use stable string IDs used by the client. Table names have a normalized sparse unique index for new API-managed records; legacy records without the normalized key remain and are checked case-insensitively on table writes.

Order creation resolves names and prices from the available menu. The server calculates bill totals and validates table occupancy, status transitions, waiter assignments, discounts, payment balances and cash change. Related order, KOT, payment and billing writes use MongoDB transactions. Payment requests require an idempotency key. The API accepts an 8–120 character key in the `Idempotency-Key` header or the `idempotencyKey` body field; reusing a key with a different payment payload returns `409`.

`RestaurantState` remains for an explicit legacy migration. Startup and Owner login do not run a migration. `GET /api/state` is a read-only compatibility projection assembled from the domain collections and filtered by role. The frontend's normal operations use domain endpoints rather than a whole-state write route.

## Authentication and role filtering

Login uses bcrypt password comparison and issues a signed JWT in an HttpOnly, SameSite=Lax cookie; the cookie is Secure when `NODE_ENV=production`. JWTs use HS256 and are checked for issuer and expiry. Each authenticated request reloads the active user from MongoDB. Password changes, account activation changes and logout invalidate existing tokens. A legacy localStorage bearer token can be exchanged once through `/api/auth/session` and is removed by the client.

For cookie-authenticated write requests that include an `Origin` header, the API checks the origin against `CLIENT_ORIGIN`. The frontend and API use credentialed requests. Role permissions are enforced on each route. The `GET /api/state` projection filters data: Waiters receive only orders they created or were assigned, their notifications, and no bill or payment collections; Kitchen Staff receive active operational orders without customer contact or financial fields and KOT items without prices; Cashiers receive billing/payment data but no KOT, audit or notification state. The `GET /api/orders` endpoint also limits Waiters to orders they created or were assigned. Manager settings omit GST number, GST rate and currency. Only Owner and Manager have item-wise report permission; Cashier receives summary report data without item rows.

The Gemini AI Assistant is read-only and restricted to Owner and Manager. It requires both `GEMINI_API_KEY` and `GEMINI_MODEL`; the API key stays on the server. Its analytics tools are constrained to restaurant data and do not return customer contact details or credentials.

## API routes

All routes below are under `/api`. Routes are authenticated unless marked **Public**. Role names indicate access enforced by the route permissions and controller filters.

### Gemini AI Assistant

| Method and path | Access | Purpose |
| --- | --- | --- |
| `POST /assistant/chat` | Owner/Manager | Ask read-only questions about supported restaurant data. Requires Gemini configuration. |

### Authentication and health

| Method and path | Access | Purpose |
| --- | --- | --- |
| `POST /auth/login` | Public | Sign in. |
| `GET /auth/me` | Authenticated | Read the current session user. |
| `POST /auth/session` | Authenticated | Exchange an existing bearer token for the session cookie; the client then removes the stored token. |
| `POST /auth/logout` | Authenticated | Invalidate the current session and clear the cookie. |
| `GET /health` | Public | Report API database readiness without connection details. |

### Restaurant data and staff

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /state` | All authenticated roles | Read the role-filtered compatibility projection. |
| `POST /migration/browser-state` | Owner | Explicitly import legacy browser state. |
| `GET /tables`, `POST /tables`, `PATCH /tables/:id` | Read: all roles with table view; write: Owner/Manager | List, create and update tables. |
| `GET /menu`, `POST /menu`, `PATCH /menu/:id` | Read: roles with menu view; write: Owner/Manager | List and manage menu items. |
| `GET /settings`, `PATCH /settings` | Owner/Manager | Read and update settings. GST number, GST rate and currency are Owner-only. |
| `GET /users`, `POST /users`, `PATCH /users/:id` | Owner; Manager is limited to Waiter account listing, creation and activation | List, create, activate/deactivate accounts, or change an account password where permitted. |
| `GET /staff/password-reset` | Owner/Manager | List resettable staff accounts. |
| `PATCH /users/:id/password` | Owner/Manager | Reset an eligible staff password; requires `password` and matching `confirmPassword`. |
| `GET /audit-events` | Owner/Manager | Read audit events, optionally filtered by `orderId`. |
| `GET /notifications`, `PATCH /notifications/:id/read` | Owner/Manager; Waiter for own notifications | Read notifications and mark permitted notifications as read. |

Owner can create accounts for supported roles. Managers can create and activate Waiters only. The reset endpoint allows Owner to reset Manager, Cashier, Waiter and Kitchen Staff passwords; Manager can reset Cashier, Waiter and Kitchen Staff passwords. The general `PATCH /users/:id` password update uses the separate 10–128 character rule and is Owner-only for password changes.

### Orders and kitchen

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /orders` | Owner/Manager/Cashier; Waiter for assigned or created orders; Kitchen Staff for active orders | List orders with role-based filtering. Kitchen Staff receive a redacted projection. |
| `POST /orders` | Owner/Manager/Waiter | Create a dine-in or takeaway order, its first KOT and bill. |
| `POST /orders/:id/items` | Owner/Manager/Waiter | Add items to an active order; Waiters may add only to assigned orders. |
| `PATCH /orders/:id/status` | Owner/Manager | Complete or cancel an order, subject to workflow requirements or a reasoned override. |
| `PATCH /orders/:id/assignment` | Owner/Manager | Assign or unassign a Waiter. |
| `GET /kots` | Owner/Manager/Kitchen Staff | List KOTs. Kitchen Staff receive ticket items without prices or menu IDs. |
| `PATCH /kots/:id/status` | Owner/Manager/Kitchen Staff; Waiter for serving an assigned KOT | Update a permitted KOT status. |
| `POST /kots/:kotId/items/:lineId/cancellations` | Owner/Manager | Cancel a quantity of an item on an eligible KOT, with a reason. |

The order status values are `Open`, `In Progress`, `Completed` and `Cancelled`. KOT status values are `Queued`, `Preparing`, `Ready`, `Served`, `Cancelled` and legacy `Closed`.

### Billing, payments and reports

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /billing` | Owner/Manager/Cashier | List bills. |
| `PATCH /billing/:orderId/discount` | Owner/Manager/Cashier | Set a fixed discount within the subtotal and remaining balance rules. |
| `PATCH /billing/:orderId/status` | Owner/Manager/Cashier | Void an eligible open bill after order cancellation. |
| `POST /billing/:orderId/payments` | Owner/Manager/Cashier | Record a Cash, UPI or Card transaction. An idempotency key is required. |
| `GET /payments` | Owner/Manager/Cashier | List payment records, with optional filters. |
| `GET /reports/summary` | Owner/Manager/Cashier | Return summary aggregates; item rows are returned only to Owner/Manager. |

The Payment model supports `Completed`, `Pending`, `Failed` and `Refunded` statuses; the payment endpoint accepts `Completed`, `Pending` and `Failed` when creating a record. Methods are `Cash`, `UPI` and `Card`. These records are not payment processor transactions, and no refund endpoint is exposed. Tips are tracked separately from the bill-applied amount. Cash records may include tender and change.

## Migration and tests

The legacy `RestaurantState` migration is explicit and does not delete the source document. From `backend/`, run it only when you intend to import the legacy record and have configured `backend/.env`:

```bash
npm run migrate:legacy
```

Run backend integration tests from `backend/`:

```bash
npm test
```

The suite starts a temporary MongoDB replica set with `mongodb-memory-server`; an initial run may download a MongoDB test binary. Tests cover authentication, role permissions, tables/menu, order and KOT workflows, billing and idempotent payments, persistence after reconnect, assistant permissions/tools and non-destructive migration. The tests do not verify Atlas credentials, network allowlisting or data in an Atlas account. Do not point them at a production database.

## Production deployment outline

**This section describes a possible deployment process; the application has not been deployed.** The project is currently documented for local use.

1. Create a MongoDB Atlas replica set and a database user with access only to the application database. Allowlist only the host or network needed by the chosen hosting provider.
2. Configure backend secrets in the hosting provider: `MONGODB_URI`, a random `JWT_SECRET` of at least 32 characters, exact frontend `CLIENT_ORIGIN`, and `NODE_ENV=production`. Set `PORT`, `MONGODB_SERVER_SELECTION_TIMEOUT_MS` and `JWT_EXPIRES_IN` only as needed. Set Owner bootstrap credentials only for first-time account creation. Leave `SEED_DEFAULT_BUSINESS_DATA` unset unless sample data is deliberately wanted.
3. From `backend/`, install with `npm ci` and start the API with `npm start`. Production mode requires `CLIENT_ORIGIN` and sets the session cookie Secure.
4. From `frontend/`, install with `npm ci`, then run `npm run lint` and `npm run build`. The static build is in `frontend/dist/`. Configure the hosting layer to serve the frontend and route `/api` to the backend on the same site so the `SameSite=Lax` cookie is sent. If using a separate API origin, set `VITE_API_URL` at frontend build time and add the exact frontend origin to backend `CLIENT_ORIGIN`; cross-site cookies are not supported by the current cookie policy.
5. Before accepting real traffic, verify `/api/health`, sign-in and a complete order/KOT/billing workflow in the configured environment. Do not run the test suite against production; it starts a temporary MongoDB replica set.
