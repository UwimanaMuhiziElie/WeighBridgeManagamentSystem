// packages/shared/lib/apiClient.ts

const DEFAULT_API_URL = 'http://localhost:3001';
const TOKEN_KEY = 'auth_token';
const BASE_URL_KEY = 'api_base_url';

function safeLocalStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {}
  return null;
}

function normalizeBaseUrl(url: string): string {
  const s = String(url || '').trim();
  if (!s) return DEFAULT_API_URL;
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function getRuntimeBaseUrl(): string {
  const storage = safeLocalStorage();
  const stored = storage?.getItem(BASE_URL_KEY);
  if (stored) return normalizeBaseUrl(stored);

  try {
    const viteUrl = (import.meta as any)?.env?.VITE_API_URL;
    if (viteUrl) return normalizeBaseUrl(String(viteUrl));
  } catch {}

  const env = typeof process !== 'undefined' ? (process as any)?.env : null;
  const nodeUrl = env?.API_URL || env?.VITE_API_URL;
  if (nodeUrl) return normalizeBaseUrl(String(nodeUrl));

  return normalizeBaseUrl(DEFAULT_API_URL);
}

function getTimeoutMs(): number {
  try {
    const t = (import.meta as any)?.env?.VITE_API_TIMEOUT_MS;
    const n = Number(t);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {}
  return 15_000;
}

export interface ApiResponse<T = any> {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
  statusCode?: number;
  [k: string]: any;
}

function isPlainObject(x: any) {
  return x && typeof x === 'object' && !Array.isArray(x);
}

function extractToken(resp: any): string | null {
  const candidates = [
    resp?.data?.token,
    resp?.data?.access_token,
    resp?.data?.accessToken,
    resp?.token,
    resp?.access_token,
    resp?.accessToken,
    resp?.data?.data?.token,
    resp?.data?.data?.access_token,
    resp?.data?.data?.accessToken,
    resp?.data?.auth?.token,
    resp?.auth?.token,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

function isFormDataBody(body: any): boolean {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

function isUrlParamsBody(body: any): boolean {
  return typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams;
}

function prepareBody(body: any): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (isFormDataBody(body)) return body;
  if (isUrlParamsBody(body)) return body;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body;
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return body as any;
  return JSON.stringify(body);
}

class ApiClient {
  private token: string | null = null;
  constructor() {
    const storage = safeLocalStorage();
    this.token = storage?.getItem(TOKEN_KEY) ?? null;
  }

  setToken(token: string | null) {
    this.token = token;
    const storage = safeLocalStorage();
    if (!storage) return;
    if (token) storage.setItem(TOKEN_KEY, token);
    else storage.removeItem(TOKEN_KEY);
  }

  getToken(): string | null {
    return this.token;
  }

  setBaseUrl(url: string | null) {
    const storage = safeLocalStorage();
    if (!storage) return;
    if (!url) storage.removeItem(BASE_URL_KEY);
    else storage.setItem(BASE_URL_KEY, normalizeBaseUrl(url));
  }

  getBaseUrl(): string {
    return getRuntimeBaseUrl();
  }

  private buildUrl(endpoint: string): string {
    const ep = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${this.getBaseUrl()}${ep}`;
  }

  private buildHeaders(options: RequestInit): Headers {
    const h = new Headers(options.headers || undefined);

    if (!h.has('Accept')) h.set('Accept', 'application/json');

    const body = options.body;
    const hasBody = body !== undefined && body !== null;
    const isForm = hasBody && isFormDataBody(body);
    const isParams = hasBody && isUrlParamsBody(body);

    if (hasBody && !isForm && !isParams && !h.has('Content-Type')) {
      h.set('Content-Type', 'application/json');
    }

    if (this.token && !h.has('Authorization')) {
      h.set('Authorization', `Bearer ${this.token}`);
    }

    return h;
  }

  private async parseResponse(response: Response): Promise<any> {
    if (response.status === 204) return null;

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      return response.json().catch(() => null);
    }

    if (contentType.includes('application/pdf') || contentType.includes('application/octet-stream')) {
      return response.blob().catch(() => null);
    }

    return response.text().catch(() => null);
  }

  private async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const timeoutMs = getTimeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(this.buildUrl(endpoint), {
        ...options,
        credentials: options.credentials ?? 'omit',
        headers: this.buildHeaders(options),
        signal: controller.signal,
      });

      const payload = await this.parseResponse(response);

      if (!response.ok) {
        const msg =
          (isPlainObject(payload) && (payload.error || payload.message)) ||
          (typeof payload === 'string' && payload) ||
          `Request failed (${response.status})`;

        if (response.status === 401) this.setToken(null);

        return {
          success: false,
          error: String(msg),
          statusCode: response.status,
        };
      }

      if (
        isPlainObject(payload) &&
        ('data' in payload || 'success' in payload || 'error' in payload || 'message' in payload)
      ) {
        const envResp = payload as ApiResponse<T>;
        if (typeof envResp.statusCode !== 'number') envResp.statusCode = response.status;
        return envResp;
      }

      return { success: true, data: payload as T, statusCode: response.status };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return { success: false, error: `Request timed out after ${timeoutMs}ms`, statusCode: 0 };
      }
      return { success: false, error: error?.message || 'Network error', statusCode: 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  async get<T = any>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T = any>(endpoint: string, body?: any, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body: prepareBody(body) });
  }

  async put<T = any>(endpoint: string, body?: any, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body: prepareBody(body) });
  }

  async patch<T = any>(endpoint: string, body?: any, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'PATCH', body: prepareBody(body) });
  }

  async delete<T = any>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  async getBlob(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<Blob>> {
    return this.request<Blob>(endpoint, { ...options, method: 'GET' });
  }

  private async postAuthFallback<T = any>(pathA: string, pathB: string, body: any): Promise<ApiResponse<T>> {
    const a = await this.post<T>(pathA, body);
    if (a?.statusCode === 404) return this.post<T>(pathB, body);
    return a;
  }

  private async getAuthFallback<T = any>(pathA: string, pathB: string): Promise<ApiResponse<T>> {
    const a = await this.get<T>(pathA);
    if (a?.statusCode === 404) return this.get<T>(pathB);
    return a;
  }

  async login(email: string, password: string): Promise<ApiResponse<{ user: any; token?: string }>> {
    const response = await this.postAuthFallback('/auth/login', '/api/auth/login', { email, password });
    const tok = extractToken(response);
    if (tok) this.setToken(tok);
    return response as ApiResponse<{ user: any; token?: string }>;
  }

  async signup(email: string, password: string, fullName: string): Promise<ApiResponse<{ user: any; token?: string }>> {
    const response = await this.postAuthFallback('/auth/signup', '/api/auth/signup', { email, password, fullName });
    const tok = extractToken(response);
    if (tok) this.setToken(tok);
    return response as ApiResponse<{ user: any; token?: string }>;
  }

  async getCurrentUser(): Promise<ApiResponse<{ user: any }>> {
    return this.getAuthFallback<{ user: any }>('/auth/me', '/api/auth/me');
  }

  async logout(): Promise<void> {
    this.setToken(null);
  }
}

const GLOBAL_KEY = '__WEIGHBRIDGE_API_CLIENT__';
const g = globalThis as any;

export const apiClient: ApiClient = g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = new ApiClient());
export default apiClient;
