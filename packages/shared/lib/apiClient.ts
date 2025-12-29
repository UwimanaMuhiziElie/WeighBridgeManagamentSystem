
const DEFAULT_API_URL = 'http://localhost:3001';

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

function getApiBaseUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viteUrl = (import.meta as any)?.env?.VITE_API_URL;
    if (viteUrl) return normalizeBaseUrl(String(viteUrl));
  } catch {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = typeof process !== 'undefined' ? (process as any)?.env : null;
  const nodeUrl = env?.API_URL || env?.VITE_API_URL;
  if (nodeUrl) return normalizeBaseUrl(String(nodeUrl));

  return normalizeBaseUrl(DEFAULT_API_URL);
}

const API_BASE_URL = getApiBaseUrl();

function getTimeoutMs(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
}

function isPlainObject(x: any) {
  return x && typeof x === 'object' && !Array.isArray(x);
}

class ApiClient {
  private token: string | null = null;

  constructor() {
    const storage = safeLocalStorage();
    this.token = storage?.getItem('auth_token') ?? null;
  }

  setToken(token: string | null) {
    this.token = token;
    const storage = safeLocalStorage();
    if (!storage) return;

    if (token) storage.setItem('auth_token', token);
    else storage.removeItem('auth_token');
  }

  getToken(): string | null {
    return this.token;
  }

  private buildUrl(endpoint: string): string {
    const ep = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${API_BASE_URL}${ep}`;
  }

  private buildHeaders(options: RequestInit): HeadersInit {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.headers as any),
    };

    const hasBody = typeof options.body !== 'undefined' && options.body !== null;
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (hasBody && !isFormData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
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
        credentials: options.credentials ?? 'include',
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
        return { success: false, error: msg };
      }

      if (
        isPlainObject(payload) &&
        ('data' in payload || 'success' in payload || 'error' in payload || 'message' in payload)
      ) {
        return payload as ApiResponse<T>;
      }

      return { success: true, data: payload as T };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return { success: false, error: `Request timed out after ${timeoutMs}ms` };
      }
      return { success: false, error: error?.message || 'Network error' };
    } finally {
      clearTimeout(timer);
    }
  }

  async get<T = any>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T = any>(endpoint: string, body: any, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body: JSON.stringify(body) });
  }

  async put<T = any>(endpoint: string, body: any, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body: JSON.stringify(body) });
  }

  async patch<T = any>(endpoint: string, body: any, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'PATCH', body: JSON.stringify(body) });
  }

  async delete<T = any>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  async getBlob(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<Blob>> {
    return this.request<Blob>(endpoint, { ...options, method: 'GET' });
  }

  async login(email: string, password: string): Promise<ApiResponse<{ user: any; token: string }>> {
    const response = await this.post<{ user: any; token: string }>('/auth/login', { email, password });
    if (response?.data?.token) this.setToken(response.data.token);
    return response;
  }

  async signup(email: string, password: string, fullName: string): Promise<ApiResponse<{ user: any; token: string }>> {
    const response = await this.post<{ user: any; token: string }>('/auth/signup', { email, password, fullName });
    if (response?.data?.token) this.setToken(response.data.token);
    return response;
  }

  async getCurrentUser(): Promise<ApiResponse<{ user: any }>> {
    return this.get<{ user: any }>('/auth/me');
  }

  async logout(): Promise<void> {
    try {
      await this.post('/auth/logout', {});
    } finally {
      this.setToken(null);
    }
  }
}

export const apiClient = new ApiClient();
export default apiClient;
