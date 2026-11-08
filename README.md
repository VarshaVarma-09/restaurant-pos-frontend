# Restaurant POS & Billing System

A full-stack restaurant point-of-sale application built to explore day-to-day service operations in one place. The React interface connects to an Express API backed by MongoDB and Mongoose. This is a resume and portfolio project intended for local inspection and development; it is not a production restaurant deployment and has no hosted demo.

## Problem and objectives

Restaurant service touches tables, orders, kitchen tickets, bills, payments and reporting. This project brings those steps into one workflow and demonstrates a full-stack application with role-based access, server-side validation, persistent domain models and a read-only Gemini assistant.

## Features

- Owner, Manager, Cashier, Waiter and Kitchen Staff accounts with UI and API permission checks.
- Restaurant dashboard, table status management, menu catalog and dine-in or takeaway orders.
- Multiple sequential kitchen order tickets (KOTs) for an order as more items are added.
- Kitchen queue transitions, waiter assignment and ready-ticket notifications.
- Consolidated order bills with configurable discount, GST, currency, partial or full payments, and separately tracked tips.
- Cash, UPI and Card payment records, cash tender/change, payment idempotency and settlement tracking. These are records in the application; no payment gateway or card processing is integrated.
- Daily, weekly, monthly and custom-date reporting, with item lifecycle and sales detail restricted by role.
- Optional, read-only Gemini Restaurant Assistant for current menu, order, kitchen, table, bill, payment and sales information.
- MongoDB transactions, audit events, input validation and explicit legacy-state migration support.

## Technology

| Area | Technologies |
| --- | --- |
| Frontend | React 19, React Router, Vite 8, JavaScript, CSS |
| Backend | Node.js (20+), Express 4, JavaScript ES modules |
| Data | MongoDB Atlas or another MongoDB replica set, Mongoose 8 |
| Authentication | bcrypt password hashes, signed JWT in an HttpOnly session cookie |
| Assistant | Google Gemini through `@google/genai` (optional) |
| Backend tests | Node test runner, Supertest, `mongodb-memory-server` |

## Architecture

The repository root contains the React/Vite client. It calls the Express API under `/api`; in local development Vite proxies those requests to `http://localhost:5000`. The backend stores tables, menu items, users, orders, KOTs, bills, payments, settings, audit events and notifications in separate Mongoose collections. The frontend does not need to connect to MongoDB directly.

The server validates order and payment operations, resolves order prices from the current menu, calculates bill totals, enforces state transitions and role permissions, and uses MongoDB transactions for related writes. `GET /api/state` is a read-only compatibility projection; ordinary client operations use domain endpoints. `RestaurantState` remains for an explicitly invoked legacy migration and is not required for normal startup.

## Repository layout

```text
restaurant-pos/
├── backend/
│   ├── config/             # MongoDB connection
│   ├── controllers/        # Auth, domain, KOT, staff, migration and assistant handlers
│   ├── middleware/         # Authentication and API role permissions
│   ├── models/             # Mongoose models for domain collections
│   ├── routes/             # REST API routes
│   ├── scripts/            # Explicit legacy-state migration command
│   ├── services/           # Analytics, Gemini and migration services
│   ├── tests/              # API integration and assistant tests
│   ├── .env.example        # Backend configuration template
│   ├── app.js
│   └── server.js
├── public/                 # Static frontend assets
├── screenshots/            # Reserved for genuine application screenshots
├── src/
│   ├── Components/         # Shared UI components
│   ├── Context/            # Authentication and restaurant API state
│   ├── Pages/              # Dashboard, orders, kitchen, billing, reports, etc.
│   ├── auth/               # Frontend route/feature permissions
│   ├── utils/               # Payment helpers
│   ├── api.js               # Fetch client
│   ├── App.jsx              # Routes and protected layout
│   └── main.jsx
├── .env.example             # Optional frontend API URL
├── package.json
└── README.md
```

## Implemented modules

- **Dashboard:** operational overview; financial cards are limited to roles with `dashboard:financial`.
- **Tables:** view and manage table names, capacity, active state and Available/Occupied/Reserved status. Active orders protect occupied tables from being freed or deactivated.
- **Menu management:** browse menu items; Owner and Manager can add or edit items and set availability.
- **Orders:** create dine-in and takeaway orders, assign waiters, add items to an active order and review order/KOT status.
- **Kitchen:** process queued KOTs and view ticket history; kitchen staff receive a redacted operational view.
- **Billing:** consolidated bill per order, discount controls, payment records, cash tender and change, and payment history.
- **Reports:** collections, tips, order counts/status, outstanding balances and, for Owner/Manager, item lifecycle and GST summaries.
- **Settings and staff:** restaurant details, role-appropriate settings, staff account management and password resets.
- **AI Assistant:** read-only questions answered with database-backed tools when configured. It is available only to Owner and Manager.

## Roles and permissions

The client hides unavailable routes and actions, and the API independently enforces permissions. The following is a summary of the configured permissions and server-side data filtering.

| Capability | Owner | Manager | Cashier | Waiter | Kitchen Staff |
| --- | --- | --- | --- | --- | --- |
| Dashboard | Full, including financials | Full, including financials | Financial dashboard | Assigned service activity | Redirected to kitchen |
| Orders | Create, view and manage | Create, view and manage | View | Create; view assigned/created; add items to assigned active orders | Active operational orders, with financial/customer fields removed |
| Kitchen tickets | View/update/cancel/serve | View/update/cancel/serve | No kitchen route | Serve own assigned KOTs | View; move Queued → Preparing → Ready |
| Tables and menu | View and manage | View and manage | View | View | No table/menu route |
| Billing and payment records | View and manage | View and manage | View and manage | No billing route/data projection | No billing route/data projection |
| Reports | Full and itemwise | Full and itemwise | Limited summary; no itemwise report | No reports | No reports |
| Settings | Full, including GST and currency | Limited; cannot view/change GST rate, GST number or currency | No settings route | No settings route | No settings route |
| Staff accounts | Manage all supported roles | Waiter management; reset Cashier, Waiter and Kitchen Staff passwords | None | None | None |
| Gemini Assistant | Yes | Yes | No | No | No |

Cashier access is intentionally limited to billing and summary reporting; itemwise sales and full GST summaries are not included in the limited report permission. Waiter and Kitchen Staff roles cannot access report or billing routes. Kitchen Staff API responses omit bill/payment data, customer contact fields and item prices. Waiters are limited to their assigned/created orders and notifications. Owner-only settings expose GST number/rate and currency; Manager settings omit those financial configuration fields. The API remains the enforcement boundary even if a client route is called directly.

## Order, kitchen and billing workflow

1. Staff create an order as **Dine-in** or **Takeaway**. A dine-in order must use an active, Available table; the server marks it Occupied. Menu prices come from the server's current available catalog, not the submitted client price.
2. Creation stores the first KOT as **Queued** and creates one consolidated bill for the order. A new KOT is created with the next sequence number whenever additional items are added to an active order with an open bill.
3. Kitchen Staff or other permitted kitchen roles move a KOT from **Queued → Preparing → Ready**. Starting preparation moves the order from Open to In Progress. Authorized staff may cancel a KOT with a reason; permitted users may cancel individual KOT item quantities with a reason. A Waiter can mark a Ready KOT **Served** only for an order assigned to them.
4. Ready tickets create notifications for the assigned Waiter (or an unassigned queue for management). Served and cancelled tickets are recorded in audit events. Legacy **Closed** KOTs can appear in history and are not treated as served.
5. The bill consolidates active KOT quantities. A discount is a fixed amount capped at the subtotal. GST is calculated on the discounted subtotal using the configured tax rate (default 18%). The Owner controls GST/currency configuration; payment tips are stored separately and do not change the bill balance or GST.
6. Record full or partial payments using **Cash**, **UPI** or **Card**. Completed payments reduce the outstanding bill balance. Cash records tendered amount and change. Payment writes require an idempotency key; these records do not charge a real card or contact a payment network.
7. The bill is settled when completed bill-applied payments cover the total, or when a zero-balance bill is explicitly settled. Normal order completion requires all KOTs served and the bill settled. A Manager/Owner can override completion with a reason. The table is released after the order is closed (completed or cancelled) and no other active dine-in order uses it; full settlement alone does not close the order.
8. Reports distinguish completed payment collections and tips from billed totals. Full reports include GST and item/KOT lifecycle details; limited reports omit item-level analysis.

Order statuses are **Open**, **In Progress**, **Completed** and **Cancelled**. KOT statuses are **Queued**, **Preparing**, **Ready**, **Served**, **Cancelled** and legacy **Closed**.

## Screenshots and demo

No application screenshots or demo video are included yet. Add genuine captures to [`screenshots/`](screenshots/README.md) and link them here when available.

| Screen | Screenshot |
| --- | --- |
| Dashboard | Not yet added |
| Orders | Not yet added |
| Tables | Not yet added |
| Menu Management | Not yet added |
| Kitchen Display | Not yet added |
| Billing | Not yet added |
| Reports | Not yet added |
| Settings | Not yet added |
| AI Restaurant Assistant | Not yet added |

**Demo video:** reserved for a future walkthrough.

## Run locally

### Requirements

- Node.js 20 or newer and npm.
- A MongoDB Atlas database or another MongoDB replica set. Order, KOT, billing and payment operations use multi-document transactions; a standalone MongoDB server is not sufficient.
- A Google Gemini API key only if you want to use the optional AI Assistant.

### 1. Clone and install

```bash
git clone https://github.com/VarshaVarma-09/restaurant-pos-frontend.git
cd restaurant-pos-frontend
npm install
cd backend
npm install
cd ..
```

The existing GitHub remote is named for the original frontend repository; it contains the combined project after publication. Do not assume a clone URL will change as part of these local edits.

### 2. Configure MongoDB and backend environment

Copy the backend template and edit the local copy:

```bash
cp backend/.env.example backend/.env
```

On Windows PowerShell:

```powershell
Copy-Item backend/.env.example backend/.env
```

Set the Atlas connection string (`MONGODB_URI`) using your own database username, password, cluster and database name. In Atlas, create a database user and allowlist the machine's network address under Network Access. Do not paste the URI into source files or commit `backend/.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | API port; defaults to `5000`. |
| `MONGODB_URI` | Yes | MongoDB connection URI. |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | No | MongoDB server selection timeout in milliseconds; defaults to `10000`. |
| `JWT_SECRET` | Yes | Private signing secret, at least 32 characters. Replace the template value with a long random secret. |
| `JWT_EXPIRES_IN` | No | JWT/session duration such as `8h`; defaults to `8h`. |
| `CLIENT_ORIGIN` | Local default works | Comma-separated allowed frontend origins; local default is `http://localhost:5173`. |
| `BOOTSTRAP_OWNER_USERNAME` | Recommended for first startup | Username for initial Owner creation. Use a username you choose. |
| `BOOTSTRAP_OWNER_PASSWORD` | Recommended for first startup | Initial Owner password, 10–128 characters. Choose your own private password; no credentials are published here. |
| `GEMINI_API_KEY` | No | Server-side Gemini API key. Needed only for the Assistant. Never use a `VITE_` variable for this secret. |
| `GEMINI_MODEL` | If Assistant enabled | Gemini model identifier used by the backend. Choose a model enabled for your API key. |
| `SEED_DEFAULT_BUSINESS_DATA` | No | Set to `true` only to create built-in example tables and menu items when those collections are empty. Unset by default. |
| `NODE_ENV` | No | Set to `production` only for a production-mode configuration; that mode requires `CLIENT_ORIGIN` and uses Secure cookies. This project is documented for local use. |

### 3. Create your own initial Owner login

At server startup, if both bootstrap variables are present and that username does not already exist, the backend creates an Owner account and hashes the password with bcrypt. The username is normalized to lowercase. The server rejects the example password and passwords shorter than 10 characters. Startup does not replace an existing account's password. Recruiters should create their own credentials in `backend/.env`; there are no shared demo credentials.

Set `SEED_DEFAULT_BUSINESS_DATA=true` if you want the supported built-in sample of six tables and four menu entries. It only inserts these when the corresponding collections are empty. Otherwise, create your own tables/menu in the app. No other seed mechanism is provided.

After the Owner signs in, use **Settings → staff accounts** to add Manager, Cashier, Waiter or Kitchen Staff users (Owner only). A Manager can manage Waiter accounts. Choose unique usernames and temporary passwords; no demo accounts are pre-created.

### 4. Configure and run the frontend

The client defaults to `/api`, and Vite proxies that path to the local backend. No frontend environment file is needed for the default local setup. To explicitly set the API base URL, copy the root `.env.example` to `.env` and set `VITE_API_URL`. Vite variables are public client configuration and must never contain secrets.

Start the API in one terminal:

```bash
cd backend
npm run dev
```

Start the frontend in a second terminal from the repository root:

```bash
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`), then log in with the Owner username and password you configured. Use Settings to create staff accounts and sign out/in to explore each role.

## Verification

Run these from the repository root unless indicated otherwise:

```bash
npm run lint
npm run build
```

Run backend integration tests from `backend/`:

```bash
npm test
```

The integration suite starts a temporary MongoDB replica set using `mongodb-memory-server`; its first run may need to download a MongoDB test binary. It does not validate Atlas credentials, Atlas network allowlisting or data in your own database. Never point the test suite at a production database.

## Troubleshooting

- **MongoDB connection timeout:** verify `MONGODB_URI`, the Atlas database user's credentials, and the current machine's Network Access allowlist entry.
- **Transaction/replica-set errors:** use Atlas or a MongoDB replica set rather than a standalone local MongoDB server.
- **Owner login does not work:** verify both bootstrap variables, password length, username spelling/case, and that the user is active. Bootstrap only creates a missing user; it does not reset an existing password.
- **Frontend cannot reach the API:** start the backend on port 5000, start Vite on port 5173, and check that the Vite `/api` proxy is available. If you set a different API origin, also configure `CLIENT_ORIGIN` and the root `VITE_API_URL`.
- **Assistant is unavailable:** verify `GEMINI_API_KEY` and `GEMINI_MODEL` in `backend/.env`, then restart the backend. Core POS features do not require Gemini.
- **Tables or menu are empty:** add them through the UI or explicitly enable the supported default sample data in an empty collection.

## Security notes

- `.env` files, dependency folders and build output are excluded by `.gitignore`; use only the example files for published configuration.
- Passwords are stored as bcrypt hashes. Session cookies are HttpOnly, SameSite=Lax and Secure in production; JWTs are issuer/expiry checked and active users are reloaded for requests.
- Cookie-authenticated writes check the configured Origin. API routes enforce role permissions and validate server-side prices, totals, payment balances and workflow transitions.
- The Gemini key is read by the backend only. Assistant tools are read-only, constrained to restaurant data and do not provide customer contact details or credentials.
- This is a portfolio application and has not been deployed or assessed for production use. Payment methods represent recorded transactions; no payment processor is connected.

## Future enhancements

- Add verified screenshots and a short demo walkthrough.
- Add automated frontend component and end-to-end workflow coverage.
- Explore a real payment provider integration with its required compliance and reconciliation flows.
- Improve deployment and operational documentation if the project later moves beyond local portfolio use.

## Author

Created by **Varsha Varma**. See the GitHub profile at [VarshaVarma-09](https://github.com/VarshaVarma-09).

## Repository presentation

Suggested repository description: **Full-stack Restaurant POS and Billing System with RBAC, order management, kitchen workflows, billing, analytics and Gemini AI integration.**

Suggested GitHub topics: `react`, `nodejs`, `express`, `mongodb`, `mongoose`, `restaurant-pos`, `billing-system`, `role-based-access-control`, `full-stack`.
