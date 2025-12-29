/*
  # Db Schema for Weighbridge Management System

  1. Core Tables
    - users: User authentication and profiles
    - branches: Company branches/locations
    - clients: Customer information
    - vehicles: Vehicle registration
    - transactions: Weighing transactions
    - invoices: Customer invoices
    - invoice_line_items: Invoice line items
    - payments: Payment records
    - pricing_rules: Dynamic pricing configuration
    - user_profiles: Extended user information
    - report_templates: Saved report configurations
    - api_keys: API authentication keys
    - api_audit_logs: API usage audit trail

  2. Features
    - UUID primary keys
    - Timestamps for audit trails
    - Proper foreign key relationships
    - Indexes for performance
*/

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (authentication)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  full_name text,
  role text NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'manager', 'operator')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Branches table
CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  location text,
  manager_id uuid REFERENCES users(id),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- User profiles (extended information)
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id),
  phone text,
  address text,
  employee_id text,
  hire_date date,
  department text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Clients table
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  contact_person text NOT NULL,
  phone text NOT NULL,
  email text NOT NULL,
  address text DEFAULT '',
  tax_id text DEFAULT '',
  credit_limit numeric(12,2) DEFAULT 0,
  current_balance numeric(12,2) DEFAULT 0,
  payment_terms text DEFAULT 'Net 30',
  notes text DEFAULT '',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Vehicles table
CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  license_plate text UNIQUE NOT NULL,
  vehicle_type text NOT NULL,
  make text,
  model text,
  year integer,
  tare_weight numeric(10,2),
  max_capacity numeric(10,2),
  notes text DEFAULT '',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  transaction_number text UNIQUE NOT NULL,
  client_id uuid REFERENCES clients(id),
  vehicle_id uuid REFERENCES vehicles(id),
  operator_id uuid REFERENCES users(id),
  transaction_type text NOT NULL CHECK (transaction_type IN ('inbound', 'outbound')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  first_weight numeric(10,2),
  second_weight numeric(10,2),
  net_weight numeric(10,2),
  first_weight_time timestamptz,
  second_weight_time timestamptz,
  material_type text DEFAULT '',
  reference_number text DEFAULT '',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id),
  invoice_number text UNIQUE NOT NULL,
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date NOT NULL,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  balance numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  payment_terms text DEFAULT 'Net 30',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Invoice line items table
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id uuid REFERENCES invoices(id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES transactions(id),
  description text NOT NULL,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL,
  amount numeric(12,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES invoices(id) ON DELETE CASCADE,
  payment_number text UNIQUE NOT NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(12,2) NOT NULL,
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'check', 'bank_transfer', 'credit_card', 'other')),
  reference_number text DEFAULT '',
  notes text DEFAULT '',
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- Pricing rules table
CREATE TABLE IF NOT EXISTS pricing_rules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  material_type text,
  client_id uuid REFERENCES clients(id),
  vehicle_type text,
  min_weight numeric(10,2),
  max_weight numeric(10,2),
  price_per_unit numeric(10,2) NOT NULL,
  unit_type text NOT NULL DEFAULT 'kg' CHECK (unit_type IN ('kg', 'ton', 'lb')),
  is_active boolean DEFAULT true,
  priority integer DEFAULT 0,
  effective_from date,
  effective_until date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Report templates table
CREATE TABLE IF NOT EXISTS report_templates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  report_type text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- API keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id uuid REFERENCES branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  rate_limit integer NOT NULL DEFAULT 60,
  ip_whitelist jsonb DEFAULT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- API audit logs table
CREATE TABLE IF NOT EXISTS api_audit_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  endpoint text NOT NULL,
  method text NOT NULL,
  status_code integer NOT NULL,
  request_body jsonb,
  response_body jsonb,
  ip_address text,
  user_agent text,
  error_message text,
  duration_ms integer,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_branches_manager_id ON branches(manager_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_branch_id ON user_profiles(branch_id);
CREATE INDEX IF NOT EXISTS idx_clients_branch_id ON clients(branch_id);
CREATE INDEX IF NOT EXISTS idx_clients_is_active ON clients(is_active);
CREATE INDEX IF NOT EXISTS idx_vehicles_client_id ON vehicles(client_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_license_plate ON vehicles(license_plate);
CREATE INDEX IF NOT EXISTS idx_transactions_branch_id ON transactions(branch_id);
CREATE INDEX IF NOT EXISTS idx_transactions_client_id ON transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_transactions_vehicle_id ON transactions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_transactions_operator_id ON transactions(operator_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_branch_id ON invoices(branch_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_transaction_id ON invoice_line_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_payments_branch_id ON payments(branch_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_branch_id ON pricing_rules(branch_id);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_client_id ON pricing_rules(client_id);
CREATE INDEX IF NOT EXISTS idx_report_templates_user_id ON report_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_report_templates_report_type ON report_templates(report_type);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_branch_id ON api_keys(branch_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_api_audit_logs_api_key_id ON api_audit_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_audit_logs_created_at ON api_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_api_audit_logs_endpoint ON api_audit_logs(endpoint);
