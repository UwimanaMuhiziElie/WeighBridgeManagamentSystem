import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import { UserProfile } from '@weighbridge/shared';

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

function isOperator(u: any): u is User {
  return !!u?.id && String(u?.role) === 'operator';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void checkAuth();
  }, []);

  async function hardLogout() {
    try {
      await apiClient.logout();
    } catch {
      // ignore (backend might be down)
    } finally {
      apiClient.setToken?.(null);
      setUser(null);
      setProfile(null);
    }
  }

  async function checkAuth() {
    try {
      const token = apiClient.getToken?.();
      if (!token) {
        setLoading(false);
        return;
      }

      const response = await apiClient.getCurrentUser?.();
      const u = response?.data?.user;

      // If token is valid but role is not operator -> deny desktop access
      if (u && !isOperator(u)) {
        await hardLogout();
        setLoading(false);
        return;
      }

      if (u) {
        setUser(u as User);

        // Prefer a real profile object if backend provides it; else fallback safely.
        const p = (response as any)?.data?.profile ?? u;
        setProfile(p as UserProfile);
      } else {
        await hardLogout();
      }
    } catch (error) {
      console.error('Auth check error:', error);
      await hardLogout();
    } finally {
      setLoading(false);
    }
  }

  async function signIn(email: string, password: string) {
    try {
      const cleanEmail = String(email || '').trim().toLowerCase();
      const pw = String(password || '');

      const response = await apiClient.login(cleanEmail, pw);

      if (response?.error) return { error: response.error };

      const u = response?.data?.user;
      if (!u) return { error: 'Login failed' };

      if (!isOperator(u)) {
        await hardLogout();
        return { error: 'Access denied. Operators only.' };
      }

      setUser(u as User);
      const p = (response as any)?.data?.profile ?? u;
      setProfile(p as UserProfile);

      return {};
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Login failed' };
    }
  }

  async function signOut() {
    await hardLogout();
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
