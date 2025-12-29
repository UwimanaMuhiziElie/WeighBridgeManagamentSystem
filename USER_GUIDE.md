# Weighbridge Management System - Complete User Guide

## Table of Contents

1. [System Overview](#system-overview)
2. [Initial Setup](#initial-setup)
3. [Desktop Application Guide](#desktop-application-guide)
4. [Web Dashboard Guide](#web-dashboard-guide)
5. [API Integration Guide](#api-integration-guide)
6. [Sample Data](#sample-data)
7. [Troubleshooting](#troubleshooting)

---

## System Overview

The Weighbridge Management System consists of three main components:

1. **Desktop Application** - For weighbridge operators to perform daily weighing operations
2. **Web Dashboard** - For administrators to manage the system, view analytics, and configure settings
3. **RESTful API** - For external integrations with accounting systems, ERP, and third-party applications

---

## Initial Setup

### Step 1: Create Your First User Account

Since the database is fresh, you'll need to create your first admin account.

#### Using the Web Dashboard:

1. **Open your browser** and navigate to the web application URL (typically `http://localhost:5173` during development)

2. **Click "Sign Up"** or navigate directly to the signup page

3. **Fill in the registration form:**
   - Email: `admin@weighbridge.com` (or your preferred email)
   - Password: Choose a secure password (at least 6 characters long)
   - Full Name: Your full name
   - Role: Select "Admin"
   - Branch: Select "Main Weighbridge Station"

4. **Click "Sign Up"** to create your account

5. **Login** with your new credentials

#### Using the Desktop Application:

1. **Launch the desktop application**

2. **On the login screen**, click "Create Account" or "Sign Up"

3. **Fill in the registration form:**
   - Email: `operator@weighbridge.com`
   - Password: Choose a secure password
   - Full Name: Your full name
   - Role: Select "Operator"
   - Branch: Select "Main Weighbridge Station"

4. **Click "Sign Up"** to create your account

5. **Login** with your new credentials

---

## Desktop Application Guide

The Desktop Application is designed for weighbridge operators working at the weighing station.

### Launch Instructions

1. **During Development:**
   ```bash
   npm run dev:desktop
   ```

2. **Production Build:**
   ```bash
   npm run build:desktop
   ```
   Then run the built application from the `dist` folder.

### Login

1. Open the desktop application
2. Enter your email and password
3. Click "Sign In"

### Main Dashboard

After logging in, you'll see the main dashboard with a sidebar navigation containing:

- **Weighing** - Create new weighing transactions
- **Monitoring** - Live monitoring of weighing operations
- **Transactions** - View and manage transaction history
- **Invoices** - Generate and view invoices
- **Reports** - Generate various reports
- **Clients** - Manage client information
- **Vehicles** - Manage vehicle registration
- **Pricing** - View and manage pricing rules
- **Settings** - System and user settings

---

### 1. Weighing Page (Main Operations)

This is where you'll spend most of your time performing weighing operations.

#### Creating a New Transaction

**Step 1: Select Client**
- Click on the "Client" dropdown
- Search for or select the client name
- Example: Select "BuildRight Construction"

**Step 2: Select Vehicle**
- Click on the "Vehicle" dropdown
- Vehicles are filtered by the selected client
- Example: Select "TRK-001 (Volvo FH16)"

**Step 3: Select Transaction Type**
- Choose "Inbound" for incoming loads
- Choose "Outbound" for outgoing loads
- Choose "Single" for one-time weighing

**Step 4: Enter Material Type**
- Type the material being weighed
- Example: "Gravel", "Steel", "Concrete", "Sand"

**Step 5: First Weighing**
- The weight from the weighbridge scale will be captured automatically
- If using manual mode, enter the weight in kilograms
- Click "Capture First Weight" button
- Example: Enter `52000` for 52,000 kg (52 tons)

**Step 6: Second Weighing (for dual-weight transactions)**
- After the vehicle unloads/loads, return for second weighing
- The system will prompt for the second weight
- Click "Capture Second Weight" button
- Example: Enter `18000` for 18,000 kg (18 tons)

**Step 7: Review Net Weight**
- The system automatically calculates: Net Weight = |First Weight - Second Weight|
- Example: 52,000 - 18,000 = 34,000 kg (34 tons)

**Step 8: Add Reference Number and Notes (Optional)**
- Reference Number: External reference like PO number
- Notes: Any additional information
- Example: Reference: "REF-001", Notes: "Morning delivery"

**Step 9: Complete Transaction**
- Click "Complete Transaction" to save
- A transaction number will be automatically generated
- Example: "TXN-2024-000021"
- A printable weighbridge ticket will be available

#### Weighbridge Ticket

After completing a transaction, you can print a ticket containing:
- Transaction number
- Date and time
- Client name
- Vehicle plate number
- First weight, second weight, net weight
- Material type
- Operator name
- Barcode for tracking

---

### 2. Monitoring Page

Live monitoring view showing:

**Current Active Transactions**
- Transactions in progress (waiting for second weight)
- Real-time weight display
- Time elapsed since first weight

**Recent Activity**
- Last 10 completed transactions
- Quick stats: Today's total weight, transaction count

**Scale Status**
- Connection status to weighbridge scale
- Current weight reading
- Calibration status

---

### 3. Transactions Page

View and search transaction history.

#### Features:

**Search and Filter:**
- Search by transaction number, client name, vehicle plate
- Filter by date range
- Filter by transaction type (Inbound/Outbound/Single)
- Filter by status (Pending/Completed/Cancelled)
- Filter by material type

**Transaction List:**
- Transaction number
- Date and time
- Client name
- Vehicle information
- Material type
- Net weight
- Status

**Actions:**
- View transaction details
- Print weighbridge ticket
- Edit transaction (if permitted)
- Cancel transaction (if permitted)

#### Example: Viewing Today's Transactions

1. Click "Transactions" in the sidebar
2. Set date filter to "Today"
3. Click "Apply Filters"
4. View list of all transactions for today
5. Click on any transaction to see full details

---

### 4. Invoices Page

Generate and manage invoices for clients.

#### Creating an Invoice

**Step 1: Select Client**
- Choose the client to invoice
- Example: "BuildRight Construction"

**Step 2: Select Date Range**
- Choose the period for transactions to include
- Example: Last 30 days

**Step 3: Select Transactions**
- The system shows all unbilled transactions for this client
- Check the transactions to include
- Example: Select 5 transactions from the last week

**Step 4: Review Calculation**
- System automatically calculates:
  - Subtotal (based on pricing rules)
  - Tax amount (configurable tax rate, default 10%)
  - Total amount
- Example: Subtotal: $2,550.00, Tax: $255.00, Total: $2,805.00

**Step 5: Set Payment Terms**
- Choose payment terms: Net 15, Net 30, Net 45, Due on Receipt
- Set due date
- Example: Net 30 (due in 30 days)

**Step 6: Add Notes (Optional)**
- Add any special notes or instructions
- Example: "Payment via wire transfer preferred"

**Step 7: Generate Invoice**
- Click "Generate Invoice"
- Invoice number is automatically assigned
- Example: "INV-2024-0006"

**Step 8: Print or Email**
- Print PDF invoice
- Email directly to client
- Export to accounting system

---

### 5. Reports Page

Generate various business reports.

#### Available Reports:

**Transaction Summary Report**
- Filter by date range, client, material type
- Shows: Total transactions, total weight, average weight
- Export to PDF or Excel

**Client Activity Report**
- Filter by client and date range
- Shows: Transaction count, total weight, revenue generated
- Comparison with previous periods

**Revenue Report**
- Financial summary by date range
- Shows: Total revenue, payments received, outstanding balance
- Breakdown by client and material type

**Operator Performance Report**
- Shows transactions processed by each operator
- Average processing time
- Accuracy metrics

**Material Type Report**
- Volume by material type
- Trending analysis
- Price per ton analysis

#### Example: Generating a Daily Summary Report

1. Click "Reports" in the sidebar
2. Select "Transaction Summary Report"
3. Set date range to "Today"
4. Click "Generate Report"
5. Review the report on screen
6. Click "Export to PDF" or "Export to Excel"
7. Save or print the report

---

### 6. Clients Page

Manage client information.

#### Adding a New Client

1. Click "Clients" in the sidebar
2. Click "Add New Client" button
3. Fill in the form:
   - Company Name: "ABC Construction Co"
   - Contact Person: "John Smith"
   - Phone: "+1-555-1234"
   - Email: "john@abcconstruction.com"
   - Address: "123 Business St"
   - Tax ID: "TAX123456"
   - Credit Limit: 50000
   - Payment Terms: "Net 30"
4. Click "Save Client"

#### Viewing Client Details

1. Click on any client in the list
2. View:
   - Contact information
   - Transaction history
   - Outstanding invoices
   - Total revenue
   - Payment history
   - Assigned vehicles

#### Editing Client Information

1. Click on a client
2. Click "Edit" button
3. Update information
4. Click "Save Changes"

---

### 7. Vehicles Page

Manage vehicle registration and information.

#### Registering a New Vehicle

1. Click "Vehicles" in the sidebar
2. Click "Add New Vehicle" button
3. Fill in the form:
   - Select Client: "BuildRight Construction"
   - License Plate: "TRK-011"
   - Vehicle Type: "Truck"
   - Make: "Volvo"
   - Model: "FH16"
   - Year: 2023
   - Tare Weight: 12000 kg
   - Max Capacity: 40000 kg
4. Click "Save Vehicle"

#### Vehicle Information

Each vehicle entry shows:
- License plate number
- Vehicle type and model
- Associated client
- Tare weight (empty weight)
- Maximum capacity
- Transaction history
- Last weighing date

---

### 8. Pricing Page

View pricing rules and rates.

#### Pricing Information:

**Pricing Tiers:**
- Standard Pricing: $50 per weighing + $0.025 per kg
- Premium Pricing: $75 per weighing + $0.035 per kg
- Volume Discount: $40 per weighing + $0.020 per kg
- Heavy Load: $100 per weighing + $0.030 per kg

**Client-Specific Pricing:**
- View which pricing tier is assigned to each client
- View custom discounts
- See effective dates for pricing changes

---

### 9. Settings Page

Configure system and user settings.

#### Available Settings:

**User Profile:**
- Update your name
- Change password
- Update contact information

**Weighbridge Configuration:**
- Scale connection settings
- COM port selection
- Baud rate configuration
- Auto-capture settings

**Print Settings:**
- Default printer selection
- Ticket format customization
- Logo upload

**Display Settings:**
- Theme selection (Light/Dark)
- Font size
- Language selection

---

## Web Dashboard Guide

The Web Dashboard is designed for administrators to manage the entire system.

### Launch Instructions

**During Development:**
```bash
npm run dev:web
```

**Production Build:**
```bash
npm run build:web
```

### Login

1. Open your browser
2. Navigate to the web application URL
3. Enter admin email and password
4. Click "Sign In"

### Main Dashboard Pages

After logging in, you'll see the admin dashboard with:

- **Dashboard** - Overview and key metrics
- **Branches** - Manage weighbridge locations
- **Users** - Manage user accounts and permissions
- **Pricing** - Configure system-wide pricing
- **Client Analytics** - Advanced client analytics and insights
- **Reports** - Generate comprehensive reports
- **API Management** - Manage API keys and integrations

---

### 1. Dashboard Page

Overview of the entire system.

**Key Metrics Display:**
- Total transactions today
- Total revenue today
- Active vehicles currently weighing
- Outstanding invoices amount
- Month-to-date statistics

**Recent Activity:**
- Latest transactions across all branches
- Recent payments received
- Recent invoice generation
- System alerts and notifications

**Charts and Analytics:**
- Transaction volume over time
- Revenue trends
- Client activity breakdown
- Material type distribution

---

### 2. Branches Page

Manage multiple weighbridge locations.

#### Adding a New Branch

1. Click "Branches" in the sidebar
2. Click "Add New Branch" button
3. Fill in the form:
   - Branch Name: "North Station"
   - Branch Code: "NORTH-WB"
   - Address: "456 Industrial Road"
   - Phone: "+1-555-0200"
   - Email: "north@weighbridge.com"
4. Click "Create Branch"

#### Branch Management:

- View all branches
- Edit branch information
- Assign users to branches
- View branch-specific statistics
- Activate/deactivate branches

---

### 3. Users Page

Manage user accounts and permissions.

#### Creating a New User

1. Click "Users" in the sidebar
2. Click "Add New User" button
3. Fill in the form:
   - Full Name: "Jane Operator"
   - Email: "jane@weighbridge.com"
   - Role: Select "Operator" or "Admin"
   - Branch: Assign to a branch
   - Phone: "+1-555-0150"
4. Click "Create User"
5. System sends invitation email to the user

#### User Management:

**View All Users:**
- List of all system users
- Filter by role, branch, status
- Search by name or email

**User Details:**
- Contact information
- Assigned branch
- Role and permissions
- Login history
- Activity log

**User Actions:**
- Edit user information
- Change user role
- Reset password
- Deactivate account
- View user activity

**Roles and Permissions:**

- **Admin Role:**
  - Full system access
  - User management
  - Pricing configuration
  - Branch management
  - API key generation
  - System configuration

- **Operator Role:**
  - Weighing operations
  - View transactions
  - Generate invoices
  - View reports
  - Manage clients and vehicles
  - Limited settings access

---

### 4. Pricing Page (Admin)

Configure system-wide pricing rules.

#### Managing Pricing Tiers

1. Click "Pricing" in the sidebar
2. View existing pricing tiers
3. Create new tier or edit existing:
   - Tier Name: "Corporate Discount"
   - Description: "For high-volume corporate clients"
   - Price per Weighing: $45.00
   - Price per KG: $0.022
   - Minimum Charge: $45.00
   - Effective From: Set start date
   - Effective To: Optional end date
4. Click "Save Pricing Tier"

#### Assigning Client Pricing

1. Navigate to specific client
2. Click "Assign Pricing"
3. Select pricing tier
4. Add custom discount if needed (%)
5. Set effective dates
6. Click "Apply Pricing"

---

### 5. Client Analytics Page

Advanced analytics and insights about clients.

**Available Analytics:**

**Client Performance Dashboard:**
- Top clients by revenue
- Top clients by transaction volume
- Client growth trends
- Payment behavior analysis

**Revenue Analysis:**
- Revenue by client over time
- Average transaction value by client
- Revenue forecasting
- Seasonal trends

**Client Segmentation:**
- High-value clients
- Frequent users
- Dormant clients
- New clients

**Credit Analysis:**
- Clients approaching credit limit
- Average days to payment
- Outstanding balances by client
- Payment reliability score

---

### 6. Reports Page (Admin)

Generate comprehensive system-wide reports.

**Available Reports:**

**Financial Reports:**
- Profit & Loss Statement
- Revenue by Branch
- Outstanding Receivables Report
- Payment Collection Report

**Operational Reports:**
- System-wide Transaction Summary
- Branch Performance Comparison
- Operator Productivity Report
- Equipment Utilization Report

**Compliance Reports:**
- Audit Trail Report
- Data Access Log
- Calibration Records
- Weighing Accuracy Report

---

### 7. API Management Page

Manage API keys for external integrations.

#### Generating an API Key

1. Click "API Management" in the sidebar
2. Click "Generate API Key" button
3. Fill in the form:
   - **Key Name:** "Accounting System Integration"
   - **Branch:** Select which branch this key accesses
   - **Permissions:** Select allowed operations:
     - ☑ All Permissions (*)
     - ☐ transactions:read
     - ☐ transactions:write
     - ☐ clients:read
     - ☐ clients:write
     - ☐ invoices:read
     - ☐ webhooks:write
     - ☐ attendance:read
     - ☐ attendance:write
   - **Rate Limit:** 60 requests per minute (adjustable)
   - **IP Whitelist:** Optional, comma-separated IPs
     - Example: `192.168.1.100, 10.0.0.50`
   - **Expires In:** Optional, number of days
     - Example: 90 days
4. Click "Generate Key"

#### Important: Copy Your API Key

After generation, you'll see the API key **once**:

```
wbk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0
```

**Copy and save this key securely!** You won't be able to see it again.

#### Managing API Keys

**View API Keys:**
- List of all API keys
- Key prefix for identification
- Associated branch
- Permissions assigned
- Rate limit
- Last used date
- Expiration status

**Actions:**
- Enable/Disable keys
- Delete keys
- View usage statistics

#### API Audit Logs

**View Logs:**
- Click "View Logs" button
- See all API requests:
  - Timestamp
  - Endpoint called
  - HTTP method
  - Status code
  - IP address
  - Response time (ms)

**Filter Logs:**
- By date range
- By API key
- By endpoint
- By status code
- By IP address

---

## API Integration Guide

The Weighbridge API allows external systems to integrate with your weighbridge data.

### Authentication

All API requests require an API key in the header:

```
X-API-Key: wbk_your_api_key_here
```

---

### API Endpoints

#### 1. Create Transaction

**Endpoint:** `POST /transactions-api`

**Purpose:** Create a new weighing transaction from an external system.

**Headers:**
```
X-API-Key: wbk_your_api_key_here
Content-Type: application/json
```

**Request Body:**
```json
{
  "client_id": "710f73ad-3eb7-4682-b6bc-ddea8cfced98",
  "vehicle_id": "afd6ce0f-dac3-4758-b5f9-83454b980726",
  "operator_id": "user-uuid-here",
  "transaction_type": "inbound",
  "first_weight": 52000,
  "second_weight": 18000,
  "material_type": "Gravel",
  "reference_number": "PO-12345",
  "notes": "Delivered from quarry"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "transaction-uuid",
    "transaction_number": "TXN-2024-000021",
    "net_weight": 34000,
    "status": "completed",
    "created_at": "2024-12-25T10:30:00Z"
  }
}
```

---

#### 2. Get Transaction

**Endpoint:** `GET /transactions-api/{transaction_id}`

**Purpose:** Retrieve details of a specific transaction.

**Headers:**
```
X-API-Key: wbk_your_api_key_here
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "transaction-uuid",
    "transaction_number": "TXN-2024-000021",
    "client": {
      "id": "client-uuid",
      "company_name": "BuildRight Construction",
      "contact_person": "Robert Miller"
    },
    "vehicle": {
      "id": "vehicle-uuid",
      "license_plate": "TRK-001",
      "make": "Volvo",
      "model": "FH16"
    },
    "transaction_type": "inbound",
    "first_weight": 52000,
    "second_weight": 18000,
    "net_weight": 34000,
    "material_type": "Gravel",
    "status": "completed",
    "created_at": "2024-12-25T10:30:00Z"
  }
}
```

---

#### 3. List Clients

**Endpoint:** `GET /clients-api`

**Purpose:** Get a list of all active clients.

**Headers:**
```
X-API-Key: wbk_your_api_key_here
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "client-uuid",
      "company_name": "BuildRight Construction",
      "contact_person": "Robert Miller",
      "phone": "+1-555-0201",
      "email": "robert@buildright.com",
      "credit_limit": 50000,
      "payment_terms": "Net 30"
    }
  ]
}
```

---

#### 4. Create Client

**Endpoint:** `POST /clients-api`

**Purpose:** Register a new client from an external system.

**Headers:**
```
X-API-Key: wbk_your_api_key_here
Content-Type: application/json
```

**Request Body:**
```json
{
  "company_name": "New Construction Co",
  "contact_person": "Jane Smith",
  "phone": "+1-555-9999",
  "email": "jane@newconstruction.com",
  "address": "789 Builder Lane",
  "tax_id": "TAX999999",
  "credit_limit": 30000,
  "payment_terms": "Net 30",
  "notes": "Premium client"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "new-client-uuid",
    "company_name": "New Construction Co",
    "is_active": true,
    "created_at": "2024-12-25T10:30:00Z"
  }
}
```

---

#### 5. List Invoices

**Endpoint:** `GET /invoices-api`

**Purpose:** Get a list of invoices.

**Headers:**
```
X-API-Key: wbk_your_api_key_here
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "invoice-uuid",
      "invoice_number": "INV-2024-0001",
      "client": {
        "company_name": "BuildRight Construction"
      },
      "invoice_date": "2024-12-15",
      "due_date": "2025-01-14",
      "total_amount": 2805.00,
      "paid_amount": 2805.00,
      "balance": 0,
      "status": "paid"
    }
  ]
}
```

---

#### 6. Download Invoice PDF

**Endpoint:** `GET /invoices-api/{invoice_id}/pdf`

**Purpose:** Download invoice as HTML/PDF.

**Headers:**
```
X-API-Key: wbk_your_api_key_here
```

**Response (200 OK):**
Returns HTML content that can be converted to PDF.

---

#### 7. Webhook - Invoice Paid

**Endpoint:** `POST /webhooks-api`

**Purpose:** Receive webhook notifications from accounting systems when an invoice is paid.

**Headers:**
```
X-API-Key: wbk_your_api_key_here
Content-Type: application/json
```

**Request Body:**
```json
{
  "event_type": "invoice.paid",
  "data": {
    "invoice_id": "invoice-uuid",
    "payment_amount": 2805.00,
    "payment_method": "bank_transfer",
    "payment_date": "2024-12-25"
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Payment recorded successfully"
}
```

**Supported Event Types:**
- `invoice.paid` - Invoice payment received
- `transaction.created` - New transaction notification
- `client.updated` - Client information updated

---

#### 8. Record Attendance

**Endpoint:** `POST /attendance-api`

**Purpose:** Record operator attendance and working hours (for timesheet integration).

**Headers:**
```
X-API-Key: wbk_your_api_key_here
Content-Type: application/json
```

**Request Body:**
```json
{
  "operator_id": "operator-uuid",
  "date": "2024-12-25",
  "hours_worked": 8.5,
  "shift_start": "08:00:00",
  "shift_end": "17:30:00",
  "notes": "Regular shift"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Attendance recorded successfully",
  "data": {
    "operator_id": "operator-uuid",
    "operator_name": "John Smith",
    "date": "2024-12-25",
    "hours_worked": 8.5,
    "transactions_processed": 12
  }
}
```

---

#### 9. Get Attendance Summary

**Endpoint:** `GET /attendance-api?operator_id={id}&date_from={date}&date_to={date}`

**Purpose:** Retrieve attendance summary for operators.

**Headers:**
```
X-API-Key: wbk_your_api_key_here
```

**Query Parameters:**
- `operator_id` (optional): Filter by specific operator
- `date_from` (optional): Start date (YYYY-MM-DD)
- `date_to` (optional): End date (YYYY-MM-DD)

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "operator_id": "operator-uuid",
      "operator_name": "John Smith",
      "date": "2024-12-25",
      "transactions_processed": 12
    }
  ]
}
```

---

### API Error Responses

**401 Unauthorized:**
```json
{
  "error": "API key required"
}
```

**403 Forbidden:**
```json
{
  "error": "Insufficient permissions"
}
```

**404 Not Found:**
```json
{
  "error": "Transaction not found"
}
```

**400 Bad Request:**
```json
{
  "error": "Missing required fields"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Internal server error"
}
```

---

## Sample Data

The database has been pre-populated with sample data for testing:

### Branch
- **Main Weighbridge Station**
  - Location: 123 Industrial Park Road
  - Phone: +1-555-0100
  - Email: main@weighbridge.com

### Clients (5 companies)
1. **BuildRight Construction**
   - Contact: Robert Miller
   - Phone: +1-555-0201
   - Credit Limit: $50,000
   - Payment Terms: Net 30

2. **SteelCorp Industries**
   - Contact: Jennifer Davis
   - Phone: +1-555-0202
   - Credit Limit: $75,000
   - Payment Terms: Net 45

3. **GravelMax Ltd**
   - Contact: David Wilson
   - Phone: +1-555-0203
   - Credit Limit: $40,000

4. **ConcreteWorks Inc**
   - Contact: Lisa Anderson
   - Phone: +1-555-0204
   - Credit Limit: $60,000

5. **AgriTransport Co**
   - Contact: James Taylor
   - Phone: +1-555-0205
   - Credit Limit: $35,000

### Vehicles (10 trucks)
- TRK-001 through TRK-010
- Various makes: Volvo, Mercedes, Scania, MAN, CAT, Iveco, DAF
- Tare weights: 11,000 - 45,000 kg
- Max capacities: 32,000 - 91,000 kg

### Pricing Tiers (4 tiers)
1. Standard Pricing: $50 + $0.025/kg
2. Premium Pricing: $75 + $0.035/kg
3. Volume Discount: $40 + $0.020/kg
4. Heavy Load: $100 + $0.030/kg

### Invoices (5 invoices)
- INV-2024-0001 (Paid)
- INV-2024-0002 (Issued/Pending)
- INV-2024-0003 (Issued/Partial payment)
- INV-2024-0004 (Overdue)
- INV-2024-0005 (Draft)

### Payments (2 payments)
- PAY-2024-0001: $2,805.00 (Wire Transfer)
- PAY-2024-0002: $2,500.00 (Check)

---

## Troubleshooting

### Cannot Login

**Problem:** Login fails with "Invalid credentials"

**Solutions:**
1. Verify email and password are correct
2. Check if account has been activated
3. Ensure you're using the correct application (desktop vs web)
4. Reset password if forgotten

---

### Weighbridge Scale Not Connecting

**Problem:** Desktop app shows "Scale Disconnected"

**Solutions:**
1. Check physical connection to weighbridge
2. Verify COM port settings in Settings page
3. Ensure correct baud rate is configured
4. Check serial port permissions
5. Restart the desktop application
6. Contact support if issue persists

---

### Transaction Not Saving

**Problem:** Error when trying to save transaction

**Solutions:**
1. Verify all required fields are filled:
   - Client selected
   - Vehicle selected
   - Transaction type selected
   - Weight captured
2. Check internet connection
3. Verify user has necessary permissions
4. Check system logs for specific error messages

---

### Invoice Not Generating

**Problem:** Cannot generate invoice for client

**Solutions:**
1. Verify transactions exist for selected period
2. Ensure transactions haven't already been invoiced
3. Check client credit limit hasn't been exceeded
4. Verify pricing rules are configured
5. Ensure user has invoice generation permissions

---

### API Key Not Working

**Problem:** API requests return 401 Unauthorized

**Solutions:**
1. Verify API key is correct
2. Check API key hasn't expired
3. Ensure API key is active (not disabled)
4. Verify API key has required permissions
5. Check IP address is whitelisted (if applicable)
6. Ensure header format is correct: `X-API-Key: your_key_here`

---

### Reports Not Loading

**Problem:** Reports page shows loading indefinitely

**Solutions:**
1. Check internet connection
2. Refresh the page
3. Try a smaller date range
4. Clear browser cache
5. Check if there's data for the selected period
6. Try a different report type

---

## Support

For additional help or to report issues:

- Email: support@weighbridge.com
- Phone: +1-555-0100
- Documentation: https://docs.weighbridge.com
- System Status: https://status.weighbridge.com

---

## Quick Reference Card

### Common Keyboard Shortcuts (Desktop App)

- **Ctrl + N** - New Transaction
- **Ctrl + S** - Save Transaction
- **Ctrl + P** - Print Ticket
- **Ctrl + F** - Search Transactions
- **Ctrl + ,** - Settings
- **Ctrl + Q** - Sign Out
- **F5** - Refresh Current Page
- **F11** - Toggle Fullscreen

### Transaction Status Codes

- **Pending** - Waiting for second weight
- **Completed** - Both weights captured
- **Cancelled** - Transaction voided

### Invoice Status Codes

- **Draft** - Not yet issued
- **Issued** - Sent to client
- **Paid** - Fully paid
- **Partial** - Partially paid (via balance field)
- **Overdue** - Past due date

### Payment Methods

- Cash
- Check
- Bank Transfer
- Card

---

**End of User Guide**

Last Updated: December 25, 2024
Version: 1.0.0
