export type Num = number | string;

export interface Branch {
  id: string;
  name: string;
  code?: string | null;
  location?: string | null;
  address?: string;
  phone?: string;
  email?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  branch_id: string | null;
  role: 'admin' | 'manager' | 'operator';
  email?: string;
  full_name: string;
  phone?: string | null;
  address?: string | null;
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
  credit_limit: Num;
  current_balance?: Num;
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
  make?: string | null;
  model?: string | null;
  year: number | null;
  tare_weight: Num | null;
  max_capacity: Num | null;
  is_active: boolean;
  notes: string;
  created_at: string;
}

export interface PricingTier {
  id: string;
  branch_id: string;
  name: string;
  description: string;
  price_per_weighing: Num;
  price_per_kg: Num;
  minimum_charge: Num;
  is_default: boolean;
  is_active: boolean;
  effective_from: string;
  effective_until?: string | null;
  effective_to?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientPricing {
  id: string;
  client_id: string;
  pricing_tier_id: string | null;
  price_per_weighing: Num | null;
  price_per_kg: Num | null;
  minimum_charge: Num | null;
  discount_percentage: Num;
  effective_from: string;
  effective_until?: string | null;
  effective_to?: string | null;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  branch_id: string;
  transaction_number: string;
  client_id: string | null;
  vehicle_id: string | null;
  operator_id: string | null;
  transaction_type: 'inbound' | 'outbound';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  first_weight: Num | null;
  second_weight: Num | null;
  net_weight: Num | null;
  first_weight_time: string | null;
  second_weight_time: string | null;
  material_type: string;
  reference_number: string;
  notes: string;
  client_request_id?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancelled_reason?: string | null;
  first_weight_stable?: boolean;
  first_weight_stability_ms?: number | null;
  first_weight_tolerance_kg?: Num | null;
  second_weight_stable?: boolean;
  second_weight_stability_ms?: number | null;
  second_weight_tolerance_kg?: Num | null;
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
  subtotal: Num;
  tax_rate: Num;
  tax_amount: Num;
  total_amount: Num;
  paid_amount: Num;
  balance: Num;
  payment_terms: string;
  notes: string;
  transaction_id?: string | null;
  pricing_tier_id?: string | null;
  client_pricing_id?: string | null;
  price_per_weighing?: Num | null;
  price_per_kg?: Num | null;
  minimum_charge?: Num | null;
  discount_percentage?: Num | null;
  pricing_breakdown?: string;
  pricing_calculated_at?: string | null;
  issued_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  transaction_id: string | null;
  description: string;
  quantity: Num;
  unit_price: Num;
  amount: Num;
  created_at: string;
}

export interface Payment {
  id: string;
  branch_id: string;
  invoice_id: string;
  payment_number: string;
  payment_date: string;
  paid_at?: string | null;
  amount: Num;
  payment_method: 'cash' | 'check' | 'bank_transfer' | 'credit_card' | 'other';
  reference_number: string;
  notes: string;
  created_by?: string | null;
  received_by?: string | null;
  created_at: string;
  updated_at?: string;
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
  paymentStatus?: ('draft' | 'sent' | 'paid' | 'overdue' | 'cancelled')[];
  transactionStatus?: ('pending' | 'in_progress' | 'completed' | 'cancelled')[];
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

export type SerialMode = 'poll' | 'stream';
export type SerialEncoding = 'ascii' | 'utf8' | 'utf-8' | 'latin1' | 'hex' | 'base64';

export interface SerialConfig {
  path: string;

  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
  mode?: SerialMode;          
  requestCommand?: string;     
  pollIntervalMs?: number;     
  responseWaitMs?: number;    
  encoding?: SerialEncoding;   
  delimiter?: string;          
  xon?: boolean;
  xoff?: boolean;
  rtscts?: boolean;
}

export type SerialTestReadOptions = {
  requestCommand?: string;
  responseWaitMs?: number;
  encoding?: SerialEncoding;
};

export type SerialTestReadResult = {
  success: boolean;
  raw?: string;
  weight?: number | null;
  error?: string;
};

declare global {
  interface Window {
    electron?: {
      serial: {
        listPorts: () => Promise<{ success: boolean; ports?: SerialPortInfo[]; error?: string }>;
        connect: (config: SerialConfig) => Promise<{ success: boolean; error?: string }>;
        disconnect: () => Promise<{ success: boolean; error?: string }>;
        simulateWeight: (weight: number) => Promise<{ success: boolean; error?: string }>;
        testRead?: (opts?: SerialTestReadOptions) => Promise<SerialTestReadResult>;
        onRawData?: (callback: (raw: string) => void) => () => void;
        onWeightData: (callback: (weight: number) => void) => () => void;
        onError: (callback: (error: string) => void) => () => void;
      };
    };
  }
}
