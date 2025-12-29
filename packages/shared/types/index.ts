export interface Branch {
  id: string;
  name: string;
  code: string;
  address: string;
  phone: string;
  email: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  branch_id: string | null;
  role: 'admin' | 'manager' | 'operator';
  full_name: string;
  phone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  branch_id: string;
  company_name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  tax_id: string;
  credit_limit: number;
  payment_terms: string;
  is_active: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Vehicle {
  id: string;
  client_id: string;
  license_plate: string;
  vehicle_type: string;
  make: string;
  model: string;
  year: number | null;
  tare_weight: number | null;
  max_capacity: number | null;
  is_active: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface PricingTier {
  id: string;
  branch_id: string;
  name: string;
  description: string;
  price_per_weighing: number;
  price_per_kg: number;
  minimum_charge: number;
  is_default: boolean;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientPricing {
  id: string;
  client_id: string;
  pricing_tier_id: string | null;
  price_per_weighing: number | null;
  price_per_kg: number | null;
  minimum_charge: number | null;
  discount_percentage: number;
  effective_from: string;
  effective_to: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  branch_id: string;
  transaction_number: string;
  client_id: string;
  vehicle_id: string;
  operator_id: string;
  transaction_type: 'inbound' | 'outbound';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  first_weight: number;
  second_weight: number | null;
  net_weight: number | null;
  first_weight_time: string;
  second_weight_time: string | null;
  material_type: string;
  reference_number: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  branch_id: string;
  invoice_number: string;
  client_id: string;
  invoice_date: string;
  due_date: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  paid_amount: number;
  balance: number;
  payment_terms: string;
  notes: string;
  issued_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  transaction_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  created_at: string;
}

export interface Payment {
  id: string;
  branch_id: string;
  invoice_id: string;
  payment_number: string;
  payment_date: string;
  amount: number;
  payment_method: 'cash' | 'check' | 'bank_transfer' | 'credit_card' | 'other';
  reference_number: string;
  notes: string;
  received_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ReportType =
  | 'customer'
  | 'periodic'
  | 'operator'
  | 'vehicle'
  | 'revenue'
  | 'outstanding_invoices'
  | 'branch'
  | 'consolidated';

export interface ReportFilter {
  reportType: ReportType;
  dateFrom: string;
  dateTo: string;
  branchIds?: string[];
  clientId?: string;
  operatorId?: string;
  vehicleId?: string;
  paymentStatus?: ('draft' | 'issued' | 'paid' | 'overdue' | 'cancelled')[];
  transactionStatus?: ('pending' | 'completed' | 'cancelled')[];
}

export interface ReportTemplate {
  id: string;
  user_id: string;
  name: string;
  report_type: ReportType;
  filters: ReportFilter;
  created_at: string;
  updated_at: string;
}

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  productId?: string;
  vendorId?: string;
}

export interface SerialConfig {
  path: string;
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
}

declare global {
  interface Window {
    electron?: {
      serial: {
        listPorts: () => Promise<{ success: boolean; ports?: SerialPortInfo[]; error?: string }>;
        connect: (config: SerialConfig) => Promise<{ success: boolean; error?: string }>;
        disconnect: () => Promise<{ success: boolean; error?: string }>;
        simulateWeight: (weight: number) => Promise<{ success: boolean; error?: string }>;
        onWeightData: (callback: (weight: number) => void) => () => void;
        onError: (callback: (error: string) => void) => () => void;
      };
    };
  }
}
