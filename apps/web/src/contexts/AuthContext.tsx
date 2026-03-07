import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import type { UserProfile } from '@weighbridge/shared';

type User = {
  id: string | number;
  email: string;
  full_name?: string | null;
  role: string; // backend role string
  branch_id?: string | number | null;
};

type AuthContextType = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean; // bootstrap/auth-check only
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function normalizeEmail(email: string) {
  return String(email || '').trim().toLowerCase();
}

function isValidUser(u: any): u is User {
  const idOk = typeof u?.id === 'string' || typeof u?.id === 'number';
  return (
    !!u &&
    typeof u === 'object' &&
    idOk &&
    typeof u.email === 'string' &&
    typeof u.role === 'string'
  );
}

/**
 * Supports backend shapes:
 * - { success, data: { user, token? } }
 * - { user, token? }
 * - { <user> } (me endpoint returns user directly)
 * - apiClient wrappers that might return { data: <body> }
 */
function extractUserAndToken(payload: any): { user: User | null; token: string | null } {
  const root = payload?.data ?? payload; // api wrapper
  const body = root?.data ?? root; // backend { data: ... }

  const userCandidate = body?.user ?? body?.data?.user ?? body;
  const tokenCandidate =
    body?.token ??
    body?.access_token ??
    body?.accessToken ??
    body?.data?.token ??
    body?.data?.access_token ??
    body?.data?.accessToken ??
    null;

  return {
    user: isValidUser(userCandidate) ? userCandidate : null,
    token: typeof tokenCandidate === 'string' && tokenCandidate.length > 10 ? tokenCandidate : null,
  };
}

function pickErrorMessage(resp: any): string | null {
  if (!resp) return 'Request failed';
  if (resp.error) return String(resp.error);
  if (resp.success === false) return String(resp.error || resp.message || 'Request failed');
  if (resp?.data?.success === false)
    return String(resp?.data?.error || resp?.data?.message || 'Request failed');
  return null;
}

function is404(msg: string) {
  const s = (msg || '').toLowerCase();
  return s.includes('404') || s.includes('not found') || s.includes('cannot get');
}

async function safeGetMe(): Promise<User | null> {
  // 1) Prefer method if exists
  if (typeof (apiClient as any).getCurrentUser === 'function') {
    const r = await (apiClient as any).getCurrentUser();
    const err = pickErrorMessage(r);
    if (!err) {
      const { user } = extractUserAndToken(r);
      if (user) return user;
    } else if (!is404(err)) {
      throw new Error(err);
    }
  }

  // 2) Fallback endpoints
  const candidates = ['/api/auth/me', '/auth/me'];
  for (const path of candidates) {
    const r = await apiClient.get(path);
    const err = pickErrorMessage(r);

    if (!err) {
      const { user } = extractUserAndToken(r);
      if (user) return user;
      continue;
    }

    if (is404(err)) continue;
    throw new Error(err);
  }

  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const mountedRef = useRef(true);

  const clearSession = useCallback(() => {
    apiClient.setToken?.(null);
    setUser(null);
    setProfile(null);
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const token = apiClient.getToken?.();
      if (!token) {
        clearSession();
        return;
      }

      const meUser = await safeGetMe();
      if (!mountedRef.current) return;

      if (meUser) {
        setUser(meUser);
        setProfile(meUser as unknown as UserProfile);
      } else {
        clearSession();
      }
    } catch {
      if (!mountedRef.current) return;
      clearSession();
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [clearSession]);

  useEffect(() => {
    mountedRef.current = true;
    void bootstrap();
    return () => {
      mountedRef.current = false;
    };
  }, [bootstrap]);

  const refresh = useCallback(async () => {
    try {
      const token = apiClient.getToken?.();
      if (!token) {
        clearSession();
        return;
      }

      const meUser = await safeGetMe();
      if (meUser) {
        setUser(meUser);
        setProfile(meUser as unknown as UserProfile);
      } else {
        clearSession();
      }
    } catch {
      clearSession();
    }
  }, [clearSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const emailNorm = normalizeEmail(email);
    const pw = String(password || '');

    if (!emailNorm || !pw) throw new Error('Email and password are required');
    if (typeof apiClient.login !== 'function') throw new Error('apiClient.login is not available');

    const resp = await apiClient.login(emailNorm, pw);

    const err = pickErrorMessage(resp);
    if (err) {
      apiClient.setToken?.(null);
      throw new Error(err);
    }

    const { user: loggedInUser, token } = extractUserAndToken(resp);

    // Some clients set token internally; accept that too
    const finalToken = token ?? apiClient.getToken?.() ?? null;

    if (!loggedInUser || !finalToken) {
      apiClient.setToken?.(null);
      throw new Error('Login failed');
    }

    // Ensure token is set (idempotent)
    apiClient.setToken?.(finalToken);

    setUser(loggedInUser);
    setProfile(loggedInUser as unknown as UserProfile);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiClient.logout?.();
    } catch {
      // ignore
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      profile,
      loading,
      isAuthenticated: !!user,
      signIn,
      signOut,
      refresh,
    }),
    [user, profile, loading, signIn, signOut, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
