// apps/desktop/src/contexts/AuthContext.tsx

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import type { UserProfile } from '@weighbridge/shared';

type Role = 'operator' | 'admin' | 'manager';

interface User {
  id: string;
  email: string;
  full_name?: string;
  role: Role;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LS_USER_KEY = 'auth_user';
const LS_PROFILE_KEY = 'auth_profile';

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {}
  return null;
}

function getRoleLower(u: any): string {
  const r = u?.role;
  if (typeof r === 'string') return r.trim().toLowerCase();
  if (r && typeof r === 'object' && typeof r.name === 'string') return r.name.trim().toLowerCase();
  return '';
}

function isOperator(u: any): u is User {
  return !!u?.id && getRoleLower(u) === 'operator';
}

// Extra safety: if backend returns token outside response.data.token
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
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

function extractUser(resp: any): any | null {
  return resp?.data?.user ?? resp?.user ?? resp?.data?.data?.user ?? resp?.data?.profile?.user ?? null;
}

function extractProfile(resp: any, fallbackUser: any): any {
  return resp?.data?.profile ?? resp?.profile ?? resp?.data?.data?.profile ?? fallbackUser;
}

function loadCachedSession(): { user: User | null; profile: UserProfile | null } {
  const storage = safeLocalStorage();
  if (!storage) return { user: null, profile: null };

  try {
    const uRaw = storage.getItem(LS_USER_KEY);
    const pRaw = storage.getItem(LS_PROFILE_KEY);

    const u = uRaw ? (JSON.parse(uRaw) as any) : null;
    const p = pRaw ? (JSON.parse(pRaw) as any) : null;

    return {
      user: u && isOperator(u) ? (u as User) : null,
      profile: p ? (p as UserProfile) : null,
    };
  } catch {
    return { user: null, profile: null };
  }
}

function saveCachedSession(user: User | null, profile: UserProfile | null) {
  const storage = safeLocalStorage();
  if (!storage) return;

  try {
    if (user) storage.setItem(LS_USER_KEY, JSON.stringify(user));
    else storage.removeItem(LS_USER_KEY);

    if (profile) storage.setItem(LS_PROFILE_KEY, JSON.stringify(profile));
    else storage.removeItem(LS_PROFILE_KEY);
  } catch {
    // ignore storage failures
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // ✅ prevents "checkAuth" finishing after "signIn" and wiping the new session
  const opRef = useRef(0);

  useEffect(() => {
    void checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function hardLogout(opId: number) {
    try {
      await apiClient.logout();
    } catch {
      // ignore (backend might be down)
    } finally {
      if (opId !== opRef.current) return;
      apiClient.setToken?.(null);
      setUser(null);
      setProfile(null);
      saveCachedSession(null, null);
    }
  }

  async function checkAuth() {
    const opId = ++opRef.current;
    setLoading(true);

    try {
      const token = apiClient.getToken?.();
      if (!token) {
        if (opId === opRef.current) {
          setUser(null);
          setProfile(null);
          saveCachedSession(null, null);
        }
        return;
      }

      // 1) Try real session validation if backend supports it
      try {
        const response = await apiClient.getCurrentUser?.();
        if (opId !== opRef.current) return;

        // If backend doesn't have /auth/me, shared apiClient returns {success:false,statusCode:404}
        const status = (response as any)?.statusCode;

        if (status === 404 || status === 501) {
          // 2) Fallback: restore from cached session (MVP-safe)
          const cached = loadCachedSession();
          if (cached.user) {
            setUser(cached.user);
            setProfile(cached.profile);
            return;
          }
          await hardLogout(opId);
          return;
        }

        const u = extractUser(response);

        // If token is valid but role is not operator -> deny desktop access
        if (u && !isOperator(u)) {
          await hardLogout(opId);
          return;
        }

        if (u) {
          const p = extractProfile(response, u) as UserProfile;
          setUser(u as User);
          setProfile(p);
          saveCachedSession(u as User, p);
        } else {
          await hardLogout(opId);
        }
      } catch {
        // 3) If backend is temporarily unreachable, fallback to cached session
        if (opId !== opRef.current) return;

        const cached = loadCachedSession();
        if (cached.user) {
          setUser(cached.user);
          setProfile(cached.profile);
          return;
        }

        await hardLogout(opId);
      }
    } finally {
      if (opId === opRef.current) setLoading(false);
    }
  }

  async function signIn(email: string, password: string) {
    const opId = ++opRef.current;

    try {
      const cleanEmail = String(email || '').trim().toLowerCase();
      const pw = String(password || '');

      const response = await apiClient.login(cleanEmail, pw);
      if (opId !== opRef.current) return {};

      if ((response as any)?.error) return { error: String((response as any).error) };

      // ✅ ensure token exists even if backend returns it in a weird place
      if (!apiClient.getToken?.()) {
        const tok = extractToken(response);
        if (tok) apiClient.setToken?.(tok);
      }

      const u = extractUser(response);
      if (!u) return { error: 'Login failed' };

      if (!isOperator(u)) {
        await hardLogout(opId);
        return { error: 'Access denied. Operators only.' };
      }

      const p = extractProfile(response, u) as UserProfile;

      setUser(u as User);
      setProfile(p);
      saveCachedSession(u as User, p);

      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Login failed' };
    }
  }

  async function signOut() {
    const opId = ++opRef.current;
    await hardLogout(opId);
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
