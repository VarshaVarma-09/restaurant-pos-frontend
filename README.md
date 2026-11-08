# Restaurant POS & Billing System

I built this full-stack POS application to handle everyday restaurant service operations: tables, orders, KOTs, billing, payments and reports. A React frontend communicates with an Express API that stores operational data in MongoDB through Mongoose. The app is set up for local use and portfolio review; it has not been deployed and has no live demo.

## What it does

- Provides separate Owner, Manager, Cashier, Waiter and Kitchen Staff accounts.
- Supports table and menu management, dine-in and takeaway orders, Waiter assignment and additional items on an open order.
- Creates sequential kitchen order tickets (KOTs), tracks kitchen progress, and records served or cancelled tickets and item quantities.
- Builds one consolidated bill per order, with discounts, configurable GST, partial or full payment records, and separately tracked tips.
- Shows collection and order reports, with item-wise sales and full GST summaries restricted to Owner and Manager.
- Includes an optional, read-only Gemini AI Assistant for restaurant data. It is available to Owner and Manager and requires your own Gemini API key and model configuration.

The app records payments as Cash, UPI or Card. It does not connect to a payment gateway or process card payments.

## Technology

| Area | Stack |
| --- | --- |
| Frontend | React 19, React Router, Vite 8, JavaScript and CSS |
| Runtime | Node.js 20.19+ or 22.12+ |
| Backend | Express 4, JavaScript ES modules |
| Database | MongoDB Atlas or another MongoDB replica set, with Mongoose 8 |
| Authentication | bcrypt password hashes and signed JWT session cookies |
| Optional AI | Google Gemini via `@google/genai` |
| Backend tests | Node test runner, Supertest and `mongodb-memory-server` |

## Structure

```text
restaurant-pos/
├── frontend/
│   ├── public/              # Static frontend assets
│   ├── src/
│   │   ├── Components/      # Shared interface components
│   │   ├── Context/         # Authentication and restaurant state
│   │   ├── Pages/           # Dashboard, orders, kitchen, billing, reports, etc.
│   │   ├── auth/            # Frontend permission checks
│   │   └── utils/           # Payment helpers
│   ├── .env.example
│   ├── eslint.config.js
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   └── vite.config.js
├── backend/
│   ├── config/              # MongoDB connection
│   ├── controllers/         # API handlers
│   ├── middleware/          # Authentication and API permissions
│   ├── models/              # Mongoose domain models
│   ├── routes/              # REST API routes
│   ├── scripts/             # Explicit legacy-state migration
│   ├── services/            # Analytics, assistant and migration logic
│   ├── tests/               # API and assistant tests
│   ├── .env.example
│   └── package.json
├── screenshots/             # Genuine captures can be added here
├── .gitignore
└── README.md
```

## Architecture and workflow

Vite serves the frontend from `frontend/`. The client uses `/api` by default, and the Vite development server proxies those requests to `http://localhost:5000`. The Express backend handles authentication, validation, permissions, business rules and persistence. Tables, menu items, users, orders, KOTs, bills, payments, settings, notifications and audit events have separate Mongoose models. Related order, kitchen and billing writes use MongoDB transactions, so use a replica set such as Atlas.

A staff member creates a dine-in or takeaway order. Dine-in orders require an active table with **Available** status. The backend looks up prices from the available menu and creates the first **Queued** KOT and a consolidated bill. Adding items to an active order creates another numbered KOT. Kitchen Staff move tickets from **Queued** to **Preparing** to **Ready**; permitted service staff can mark an assigned ticket **Served**. Tickets and item quantities can be cancelled with a reason by authorized roles.

The bill reflects active KOT quantities. A fixed discount cannot exceed the subtotal; GST is applied to the discounted subtotal at the configured rate. Payments can be partial or full and use Cash, UPI or Card. Cash entries also track tender and change. Tips are separate from the bill balance and GST. These are application records only: the project does not contact a payment provider. Normal order completion requires KOTs to be served and the bill settled. A Manager or Owner can override completion with a reason. The table is released when the order is completed or cancelled and no other active dine-in order uses it; settlement alone does not close the order.

Order statuses are **Open**, **In Progress**, **Completed** and **Cancelled**. KOT statuses are **Queued**, **Preparing**, **Ready**, **Served**, **Cancelled** and legacy **Closed**. A legacy Closed ticket is not counted as served.

## Roles

The frontend checks permissions before showing pages and actions. The API independently enforces role permissions and filters returned data.

| Capability | Owner | Manager | Cashier | Waiter | Kitchen Staff |
| --- | --- | --- | --- | --- | --- |
| Dashboard | All, including financials | All, including financials | Financial dashboard | Assigned service activity | Redirected to kitchen |
| Orders | Create, view and manage | Create, view and manage | View | Create; view assigned or created orders; add items to assigned orders | Active operational data; financial and contact fields are removed |
| Kitchen | View, update, serve and cancel | View, update, serve and cancel | — | Serve assigned tickets | View and update Queued, Preparing and Ready tickets |
| Tables and menu | View and manage | View and manage | View | View | — |
| Billing | View and manage | View and manage | View and manage | — | — |
| Reports | Full, including item-wise sales and GST summaries | Full, including item-wise sales and GST summaries | Limited summary | — | — |
| Settings | Full, including tax and currency | Limited; GST number, GST rate and currency are hidden and cannot be changed | — | — | — |
| Staff management | All supported roles | Waiter accounts; may reset Cashier, Waiter and Kitchen Staff passwords | — | — | — |
| Gemini AI Assistant | Yes | Yes | — | — | — |

Kitchen Staff responses omit prices, bill/payment details and customer contact data. Waiters see only orders they created or were assigned. They do not have billing or report access. Cashier reports do not include item-wise sales or full GST summaries. The assistant is restricted by API permission to Owner and Manager.

## Authentication and security

Passwords are stored as bcrypt hashes. Login issues a signed JWT in an HttpOnly, SameSite=Lax cookie; the cookie is Secure in production. The API verifies the JWT issuer and expiry, reloads the active user, and invalidates sessions when passwords or account activation change. For cookie-authenticated writes that include an `Origin` header, the API checks it against the configured allowlist. Server-side checks validate permissions, menu prices, workflow transitions, discounts, payment balances and idempotency keys. Gemini credentials stay on the backend; its assistant tools are read-only.

## Run locally

### Requirements

- Node.js 20.19 or newer, or 22.12 or newer, and npm.
- A MongoDB Atlas database or another MongoDB replica set. Standalone MongoDB does not support the transactions used by the app.
- A Gemini API key only if you want to use the assistant.

### 1. Clone and install dependencies

```bash
git clone https://github.com/VarshaVarma-09/restaurant-pos-frontend.git
cd restaurant-pos-frontend
cd frontend
npm ci
cd ../backend
npm ci
cd ..
```

In Windows PowerShell, run the same `cd` and `npm ci` commands one line at a time. Frontend and backend dependencies are installed separately.

### 2. Configure the backend

Copy the template to a local file and edit it with your own Atlas URI, JWT secret and Owner credentials.

Git Bash:

```bash
cp backend/.env.example backend/.env
```

PowerShell:

```powershell
Copy-Item backend/.env.example backend/.env
```

Do not commit `backend/.env`. The `.gitignore` excludes local environment files.

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Yes | MongoDB connection URI. Configure a database user and Atlas Network Access allowlist. |
| `JWT_SECRET` | Yes | JWT signing secret, at least 32 characters. Replace the example value with a long random secret. |
| `PORT` | No | API port; defaults to `5000`. |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | No | Connection selection timeout; defaults to `10000` milliseconds. |
| `JWT_EXPIRES_IN` | No | Session lifetime such as `8h`; defaults to `8h`. |
| `CLIENT_ORIGIN` | Local default works | Allowed frontend origin(s); local default is `http://localhost:5173`. |
| `BOOTSTRAP_OWNER_USERNAME` | For first Owner | Username for the bootstrap account; the backend normalizes it to lowercase. |
| `BOOTSTRAP_OWNER_PASSWORD` | For first Owner | Your private initial Owner password. Startup requires at least 10 characters and rejects the literal example value. The login endpoint accepts passwords up to 128 characters; choose 10–128 characters for a usable login. |
| `GEMINI_API_KEY` | Optional | Your server-side Gemini API key. Required only for the AI Assistant. |
| `GEMINI_MODEL` | Optional | Gemini model identifier; set it when enabling the assistant. |
| `SEED_DEFAULT_BUSINESS_DATA` | Optional | Set to `true` to add six sample tables and four menu items only when those collections are empty. |

The Owner account is created at startup only when both bootstrap values are set and that username does not already exist. Startup never overwrites an existing Owner password. Anyone running the project locally must configure their own username and password; this repository contains no demo credentials. Sample tables/menu data are optional and are not seeded by default.

### 3. Optional frontend configuration

The frontend uses `/api` by default, so the local Vite proxy needs no additional setting. To use a different API base, copy `frontend/.env.example` to `frontend/.env` and set `VITE_API_URL`. Vite variables are bundled into the browser and must not contain secrets.

Git Bash:

```bash
cp frontend/.env.example frontend/.env
```

PowerShell:

```powershell
Copy-Item frontend/.env.example frontend/.env
```

### 4. Start the app

Run the backend in one terminal:

```bash
cd backend
npm run dev
```

Run the frontend in a second terminal:

```bash
cd frontend
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`, and log in with the Owner credentials you configured. In **Settings**, the Owner can create Manager, Cashier, Waiter and Kitchen Staff accounts. A Manager can create and manage Waiter accounts.

Staff account creation requires a password of **10–128 characters**. Staff password resets through `PATCH /api/users/:id/password` accept **8–128 characters** and require a matching confirmation. A separate Owner-only password change through `PATCH /api/users/:id` requires 10–128 characters. Owner and Manager reset access follows the role table above.

### Environment reference

The backend template also includes `NODE_ENV` as an optional production-mode setting. Production mode requires a configured `CLIENT_ORIGIN` and enables Secure session cookies. This README covers local development only. The frontend API URL template is at `frontend/.env.example`.

## Verification

Run frontend checks from `frontend/`:

```bash
npm run lint
npm run build
```

Run backend tests from `backend/`:

```bash
npm test
```

The backend suite uses `mongodb-memory-server` to start a temporary replica set; its first run may download a MongoDB test binary. It does not test Atlas credentials or network allowlisting. Do not point tests at a real restaurant database.

## Limitations and troubleshooting

- The app has no hosted deployment or demo video. It is a portfolio project and has not been assessed for production operation.
- Payments are recorded in the app; no card processor, bank/UPI integration or refund flow is connected.
- The Gemini AI Assistant is optional, read-only, and unavailable until the backend has a valid `GEMINI_API_KEY` and `GEMINI_MODEL`.
- If MongoDB times out, check the URI, database user and Atlas Network Access allowlist. Use a replica set for transactional workflows.
- If the frontend cannot reach the API, run the backend on port 5000 and Vite from `frontend/` on port 5173. Check that `frontend/vite.config.js` still proxies `/api` to `http://localhost:5000`.
- If Owner login fails, check both bootstrap variables and confirm the username exists and is active. Bootstrap only creates a missing account; it does not reset passwords.
- If no tables or menu items appear, create them in the app or enable the documented sample-data option for empty collections.

## Screenshots

There are no genuine application screenshots yet. The root `screenshots/` directory contains a note for adding real captures later. No screenshots or demo video are presented as available.

## Author

Created by **Varsha Varma Pothuri**. [GitHub profile](https://github.com/VarshaVarma-09).
