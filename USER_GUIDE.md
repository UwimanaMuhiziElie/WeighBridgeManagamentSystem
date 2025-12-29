````md
# Weighbridge Management System — User Guide

_Last updated: December 29, 2025 • Version: 1.1.0_

## Table of Contents

1. [System Overview](#system-overview)
2. [Initial Setup](#initial-setup)
3. [Desktop Application Guide](#desktop-application-guide)
4. [Web Dashboard Guide](#web-dashboard-guide)
5. [API Integration Guide](#api-integration-guide)
6. [Sample Data](#sample-data)
7. [Troubleshooting](#troubleshooting)
8. [Quick Reference](#quick-reference)

---

## System Overview

The Weighbridge Management System has three main components:

1. **Desktop Application (Operator App)**  
   Used at the weighbridge station to capture weights, create transactions, and generate invoices.

2. **Web Dashboard (Admin/Manager Portal)**  
   Used by admins/managers to manage branches, users, clients, vehicles, pricing, and reports.

3. **Backend REST API (Internal + External API)**  
   Used by the desktop app and web dashboard, and optionally by third-party systems via API keys.

### Key Concepts

- **Branch**: A weighbridge station/location. Data is scoped by branch.
- **Roles**:
  - **Operator**: Uses the desktop app for weighing operations (operators are restricted to their branch).
  - **Manager/Admin**: Uses the web dashboard for system administration (may manage multiple branches depending on your setup).
- **Transaction workflow**:
  - Record **FIRST weight** (Gross) → transaction becomes **pending**
  - Record **SECOND weight** (Tare) → transaction becomes **completed** and an **invoice** is generated (if enabled/configured)
- **Resilience**:
  - Desktop supports **safe retry / offline-safe queue** for operations like creating/finishing transactions.
  - Backend supports **idempotency** (prevents duplicates when the app retries due to timeouts or reconnection).

---

## Initial Setup

### Requirements

- Node.js + npm
- PostgreSQL (database)
- (Optional for scale integration) USB/Serial scale drivers installed on the operator machine

### Step 1: Configure Environment

1. Start PostgreSQL and create the database.
2. Apply migrations (including the idempotency migration if present).
3. Configure backend environment variables, for example:
   - Database connection (PostgreSQL)
   - API port (default often `3001`)
4. Configure frontend environment variables (web + desktop renderer), for example:
   - `VITE_API_URL` (example: `http://localhost:3001`)

> In production, use a real hostname for `VITE_API_URL` (e.g., `https://api.yourdomain.com`).

### Step 2: Create Your First User Account

#### Using the Web Dashboard (recommended for first admin)

1. Open the web dashboard (development example):  
   `http://localhost:5173`

2. Click **Sign Up**.

3. Fill in the registration form:
   - Email: `admin@weighbridge.com` (or your email)
   - Password: choose a strong password
   - Full Name: your full name
   - Role: **Admin**
   - Branch: select or create your branch (depending on your setup)

4. Click **Sign Up**, then login.

#### Desktop Application Notes (Operators only)

The desktop app is designed for **operators**.  
If you try to sign in with an Admin/Manager account, access is denied (by design).

---

## Desktop Application Guide

The Desktop Application is for weighbridge operators at the station.

### Launch Instructions

**During Development**
```bash
npm run dev:desktop
````

**Production Build**

```bash
npm run build:desktop
```

### Login

1. Launch the desktop app
2. Enter operator email and password
3. Click **Sign In**

> If login succeeds but you are not an Operator, the desktop app will deny access.

---

### Main Navigation (Desktop)

Typical desktop menu includes:

* **Weighing** — record weights and generate invoices
* **Transactions** — view recent transactions and search
* (Other pages may exist depending on your build: Monitoring, Reports, Invoices, Clients, Vehicles, Settings)

> Note: Some pages require backend endpoints to be enabled (e.g. transactions listing).

---

## Weighing Page (Main Operations)

This is the core operator workflow.

### A) Scale Connection (Serial)

1. Go to **Weighing** page.
2. Under **Scale connection**, click **Refresh ports**.
3. Select the correct serial port (COM on Windows, `/dev/tty*` on Linux).
4. Set serial configuration if needed:

   * Baud rate (example: 9600)
   * Parity, data bits, stop bits
5. Click **Connect**.

#### Live Weight Status

* **Connected**: scale is connected
* **Receiving data**: weight data is updating
* **No recent readings**: connected but no new weight reading recently (check cable/driver/scale)

#### Simulation Mode

If you are testing without a real scale:

* Enter a value in the simulation input (example: `123.45`)
* Click **Simulate**

---

### B) Recording a Transaction (Two-step)

#### Step 1 — Select Client

* Choose the client from the dropdown.
* Operators typically see clients belonging to their branch.

#### Step 2 — Select Vehicle

* Vehicles are filtered by the selected client.
* Choose the correct vehicle from the dropdown.

#### Step 3 — Select Transaction Type

* **Inbound** or **Outbound**

#### Step 4 — Optional details

* Material (example: `sand`)
* Reference (PO / delivery ref)
* Notes (optional)

#### Step 5 — Record FIRST Weight (Gross)

* Confirm the live weight is stable and not stale.
* Click **Record FIRST weight (Gross)**.
* The system creates a **pending** transaction.

**What you should see**

* An “Active” badge with a transaction number (example: `TXN-BR-20251229-XXXXXX`)

#### Step 6 — Record SECOND Weight (Tare) + Create Invoice

* When the vehicle returns, confirm the weight is stable.
* Click **Record SECOND weight (Tare) + Create Invoice**.
* The system completes the transaction and generates an invoice.

**What you should see**

* A “Completed” section showing:

  * Invoice number
  * Total amount
  * Pricing breakdown

#### Download Invoice PDF

If the invoice PDF endpoint is enabled:

* Click **Download invoice PDF**

---

### C) Offline / Retry Behavior (Important)

If the backend is temporarily unreachable (network drop, timeout), the desktop app will:

* Save the action locally (queue it)
* Show a banner like: **Pending sync actions**
* Auto-sync when connection returns
* You can also click **Sync now**

This prevents losing work and prevents duplicate transactions (backend idempotency).

---

## Transactions Page (Desktop)

The Transactions page shows recent transactions and supports search.

### What it shows

* Transaction number
* Client
* Vehicle
* Status
* Net weight
* Created date/time

### If you see “endpoint not available yet”

That means the backend list endpoint isn’t enabled.
Enable:

* `GET /api/transactions?limit=50`

---

## Web Dashboard Guide

The Web Dashboard is for Admins/Managers.

### Launch Instructions

**During Development**

```bash
npm run dev:web
```

**Production Build**

```bash
npm run build:web
```

### Login

1. Open the web app URL
2. Enter admin/manager email and password
3. Click **Sign In**

---

### Dashboard (Web)

Typical admin dashboard provides:

* Transactions overview
* Revenue overview
* Outstanding invoices
* Branch summaries
* Recent activity

(Exact widgets depend on your implementation.)

---

### Branches (Web)

Admins can:

* Create branches
* Assign users to branches
* View branch-specific activity

---

### Users (Web)

Admins can:

* Create and manage users
* Assign roles and branches
* Reset passwords / deactivate accounts (depending on implementation)

**Roles**

* **Admin**: full access
* **Manager**: operational oversight (depending on policy)
* **Operator**: station operations (desktop access)

---

### Clients & Vehicles (Web)

Admins/Managers can:

* Add and update clients
* Add and update vehicles
* Link vehicles to clients

---

### Pricing (Web)

Pricing can be configured by branch using:

* **Pricing tiers**
* **Client-specific pricing overrides**

The system uses pricing rules during transaction completion / invoice generation.

---

## API Integration Guide

The system can expose external integration endpoints protected by **API keys**.

> Note: The exact external routes and permissions depend on your implementation.
> This guide describes a recommended structure and expected behavior.

### Authentication (External API)

External API requests require an API key header:

```
X-API-Key: wbk_your_api_key_here
```

### Idempotency (Highly Recommended)

For endpoints that create transactions or invoices, include:

```
Idempotency-Key: <unique-request-id>
```

This prevents duplicates if you retry due to timeouts.

---

### Common External API Endpoints (Example)

> Replace these paths with your actual external API routes if different.

#### 1) Create Transaction (Two-step preferred)

**Create FIRST weight**

* `POST /transactions-api`

```json
{
  "client_id": "client-uuid",
  "vehicle_id": "vehicle-uuid",
  "operator_id": "operator-uuid",
  "transaction_type": "inbound",
  "first_weight": 52000,
  "material_type": "Gravel",
  "reference_number": "PO-12345",
  "notes": "Delivered from quarry"
}
```

**Complete transaction (SECOND weight)**

* `PATCH /transactions-api/{transaction_id}/complete`

```json
{
  "second_weight": 18000
}
```

#### 2) Get Transaction

* `GET /transactions-api/{transaction_id}`

#### 3) List Clients

* `GET /clients-api`

#### 4) Create Client

* `POST /clients-api`

#### 5) List Invoices

* `GET /invoices-api`

#### 6) Download Invoice PDF

* `GET /invoices-api/{invoice_id}/pdf`

---

### API Error Responses (External)

**401 Unauthorized**

```json
{ "error": "API key required" }
```

**403 Forbidden**

```json
{ "error": "Insufficient permissions" }
```

**404 Not Found**

```json
{ "error": "Resource not found" }
```

**400 Bad Request**

```json
{ "error": "Missing or invalid fields" }
```

**500 Internal Server Error**

```json
{ "error": "Internal server error" }
```

---

## Sample Data

If your database seeds include demo data, you may see:

### Branch

* Main Weighbridge Station

### Clients

* Example construction / logistics companies

### Vehicles

* Example trucks linked to clients

### Pricing tiers

* Standard / Premium / Volume Discount / Heavy Load (examples)

> If you do NOT seed data, remove this section or update it to match your actual seed scripts.

---

## Troubleshooting

### Cannot Login

**Symptoms**

* “Invalid credentials”
* “Access denied”

**Fix**

1. Verify email/password
2. Confirm the account exists and is active
3. Desktop requires **Operator** role

---

### Scale Not Connecting

**Symptoms**

* Desktop shows “Disconnected”
* No ports appear

**Fix**

1. Check USB cable / adapter
2. Install correct drivers (Windows COM drivers if needed)
3. Click **Refresh ports**
4. Select the correct port
5. Verify baud rate/parity settings match the scale
6. Restart the desktop app

---

### “No recent readings”

**Symptoms**

* Connected, but the status says “No recent readings”

**Fix**

1. Confirm the scale is powered on and sending data
2. Verify correct port selected
3. Check driver stability
4. Try reconnecting

---

### Transaction Not Saving

**Symptoms**

* Error banner appears
* Network timeout

**Fix**

1. Confirm required fields are selected (client, vehicle)
2. Confirm weight is not stale
3. Check backend is running
4. If backend is down, the desktop will queue the action. Use **Sync now** when backend returns.

---

### Transactions Page Shows “Endpoint not available”

**Fix**

* Implement/enable:

  * `GET /api/transactions?limit=50`

---

### Invoice PDF Not Downloading

**Fix**

1. Confirm invoice exists
2. Confirm backend PDF route is implemented:

   * `GET /api/invoices/{id}/pdf`
3. Check server logs for PDF generation errors

---

## Quick Reference

### Transaction Status

* **pending** — first weight recorded, waiting for second weight
* **completed** — both weights recorded, net weight final, invoice created (if enabled)
* **cancelled** — voided (if enabled)

### Desktop Tips

* Always confirm live weight is updating before recording
* If internet drops, you can keep working; sync later
* Use the Transactions page to confirm records are saved

---

**End of User Guide**
