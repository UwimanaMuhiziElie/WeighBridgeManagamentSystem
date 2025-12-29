import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
  useCallback,
} from 'react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import type { UserProfile } from '@weighbridge/shared';

type User = {
  id: string;
  email: string;
  full_name?: string | null;
  role: string;
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
  return !!u && typeof u === 'object' && typeof u.id === 'string' && typeof u.email === 'string' && typeof u.role === 'string';
}

/**
 * Supports backend shapes:
 * - { success, data: { user, token? } }
 * - { user, token? }
 * - apiClient wrappers that might return { data: <body> }
 */
function extractUserAndToken(payload: any): { user: User | null; token: string | null } {
  const root = payload?.data ?? payload;     // apiClient wrapper
  const body = root?.data ?? root;           // backend { data: ... }

  const user = body?.user ?? body?.data?.user ?? null;
  const token = body?.token ?? body?.data?.token ?? null;

  return {
    user: isValidUser(user) ? user : null,
    token: typeof token === 'string' && token.length > 10 ? token : null,
  };
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

      // /auth/me => { success, data: { user } }
      const resp = await apiClient.getCurrentUser();
      const { user: meUser } = extractUserAndToken(resp);

      if (!mountedRef.current) return;

      if (meUser) {
        setUser(meUser);
        // Until you have a real profile endpoint, keep this for UI compatibility.
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
    bootstrap();
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

      const resp = await apiClient.getCurrentUser();
      const { user: meUser } = extractUserAndToken(resp);

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

    if (!emailNorm || !pw) {
      throw new Error('Email and password are required');
    }

    const resp = await apiClient.login(emailNorm, pw);

    if ((resp as any)?.error) {
      // prevent “half logged-in” state if an old token exists
      apiClient.setToken?.(null);
      throw new Error((resp as any).error);
    }

    const { user: loggedInUser, token } = extractUserAndToken(resp);

    // apiClient.login already sets token if present, but we enforce correctness here
    if (!loggedInUser || !token) {
      apiClient.setToken?.(null);
      throw new Error('Login failed');
    }

    apiClient.setToken?.(token);
    setUser(loggedInUser);
    setProfile(loggedInUser as unknown as UserProfile);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiClient.logout();
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
