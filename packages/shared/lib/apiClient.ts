// packages/shared/lib/apiClient.ts

//come back to this keys
const TOKEN_KEY = 'auth_token'; 
const BASE_URL_KEY = 'api_base_url';
const BASE_URL_USER_SET_KEY = 'api_base_url_user_set';

function safeLocalStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {}
  return null;
}

function normalizeBaseUrl(url: string): string {
  const s = String(url || '').trim();
  if (!s) return '';
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function isLoopbackUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = (u.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    // If it isn't a valid URL, treat as unsafe and NOT loopback
    return false;
  }
}

function getViteApiUrl(): string {
  try {
    const viteUrl = (import.meta as any)?.env?.VITE_API_URL;
    return viteUrl ? normalizeBaseUrl(String(viteUrl)) : '';
  } catch {
    return '';
  }
}

function getNodeApiUrl(): string {
  try {
    const env = typeof process !== 'undefined' ? (process as any)?.env : null;
    const nodeUrl = env?.API_URL || env?.API_BASE_URL || env?.VITE_API_URL;
    return nodeUrl ? normalizeBaseUrl(String(nodeUrl)) : '';
  } catch {
    return '';
  }
}

/**
 * Base URL strategy (Desktop):
 * 1) If user explicitly set api_base_url (api_base_url_user_set=true), use it.
 * 2) Otherwise, prefer Vite env VITE_API_URL (production default).
 * 3) Otherwise, Node/Electron env.
 * 4) Otherwise, browser-derived (same host :3001) when hostname exists.
 * 5) Fallback localhost:3001.
 *
 * Extra safety(later on, not now):
 * - If stored api_base_url is loopback (localhost) but VITE_API_URL is non-loopback,
 *   auto-migrate to VITE_API_URL so login never gets stuck.
 */
function getRuntimeBaseUrl(): string {
  const storage = safeLocalStorage();

  const stored = storage?.getItem(BASE_URL_KEY) ?? '';
  const storedNorm = stored ? normalizeBaseUrl(stored) : '';

  const userSet = (storage?.getItem(BASE_URL_USER_SET_KEY) ?? '') === 'true';

  const viteUrl = getViteApiUrl();
  const nodeUrl = getNodeApiUrl();

  // 1) If user explicitly set it, always respect it
  if (userSet && storedNorm) return storedNorm;

  // Auto-fix legacy/stale localhost override if we have a real env URL
  if (storedNorm && isLoopbackUrl(storedNorm)) {
    const preferred = viteUrl && !isLoopbackUrl(viteUrl) ? viteUrl : nodeUrl && !isLoopbackUrl(nodeUrl) ? nodeUrl : '';
    if (preferred) {
      try {
        storage?.setItem(BASE_URL_KEY, preferred);
        storage?.setItem(BASE_URL_USER_SET_KEY, 'false');
      } catch {}
      return preferred;
    }
  }

  // 2) Prefer Vite env (best for packaged desktop/web)
  if (viteUrl) return viteUrl;

  // 3) Node/Electron env
  if (nodeUrl) return nodeUrl;

  // 4) Browser-derived: same host, port 3001 (only when hostname exists)
  try {
    if (typeof window !== 'undefined' && window.location) {
      const { protocol, hostname } = window.location;
      if (hostname) {
        if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:3001';
        return `${protocol}//${hostname}:3001`;
      }
    }
  } catch {}

  // 5) Final fallback
  return 'http://localhost:3001';
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

  // IMPORTANT: mark as user-set so it persists
  setBaseUrl(url: string | null) {
    const storage = safeLocalStorage();
    if (!storage) return;

    if (!url) {
      storage.removeItem(BASE_URL_KEY);
      storage.removeItem(BASE_URL_USER_SET_KEY);
      return;
    }

    const n = normalizeBaseUrl(url);
    if (!n) return;

    storage.setItem(BASE_URL_KEY, n);
    storage.setItem(BASE_URL_USER_SET_KEY, 'true');
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
    if (contentType.includes('application/json')) return response.json().catch(() => null);
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

        return { success: false, error: String(msg), statusCode: response.status };
      }

      if (isPlainObject(payload) && ('data' in payload || 'success' in payload || 'error' in payload || 'message' in payload)) {
        const envResp = payload as ApiResponse<T>;
        if (typeof envResp.statusCode !== 'number') envResp.statusCode = response.status;
        return envResp;
      }

      return { success: true, data: payload as T, statusCode: response.status };
    } catch (error: any) {
      if (error?.name === 'AbortError') return { success: false, error: `Request timed out after ${timeoutMs}ms`, statusCode: 0 };
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

  async getCurrentUser(): Promise<ApiResponse<{ user: any }>> {
    return this.getAuthFallback<{ user: any }>('/auth/me', '/api/auth/me');
  }

  async logout(): Promise<void> {
    this.setToken(null);
  }
}

const GLOBAL_KEY = '__WEIGHBRIDGE_API_CLIENT__';
const g = globalThis as any;

function upgradeClient(c: any) {
  if (!c || typeof c !== 'object') return null;

  // If request exists, we can polyfill missing verbs safely
  if (typeof c.request === 'function') {
    if (typeof c.get !== 'function') {
      c.get = (endpoint: string, options: RequestInit = {}) =>
        c.request(endpoint, { ...options, method: 'GET' });
    }

    if (typeof c.post !== 'function') {
      c.post = (endpoint: string, body?: any, options: RequestInit = {}) =>
        c.request(endpoint, { ...options, method: 'POST', body: prepareBody(body) });
    }

    if (typeof c.put !== 'function') {
      c.put = (endpoint: string, body?: any, options: RequestInit = {}) =>
        c.request(endpoint, { ...options, method: 'PUT', body: prepareBody(body) });
    }

    // This is the one breaking Scale-Otu
    if (typeof c.patch !== 'function') {
      c.patch = (endpoint: string, body?: any, options: RequestInit = {}) =>
        c.request(endpoint, { ...options, method: 'PATCH', body: prepareBody(body) });
    }

    if (typeof c.delete !== 'function') {
      c.delete = (endpoint: string, options: RequestInit = {}) =>
        c.request(endpoint, { ...options, method: 'DELETE' });
    }

    if (typeof c.getBlob !== 'function') {
      c.getBlob = (endpoint: string, options: RequestInit = {}) =>
        c.request(endpoint, { ...options, method: 'GET' });
    }
  }

  return c;
}

const existing = upgradeClient(g[GLOBAL_KEY]);
const client: ApiClient = (existing as ApiClient) ?? new ApiClient();

// Always ensure the stored client is upgraded
upgradeClient(client);
g[GLOBAL_KEY] = client;

export const apiClient: ApiClient = client;
export default apiClient;