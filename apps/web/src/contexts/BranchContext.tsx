import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiClient } from '@weighbridge/shared/lib/apiClient';
import { useAuth } from './AuthContext';

type Role = 'operator' | 'admin' | 'manager';

type Branch = {
  id: string | number;
  name?: string;
  branch_name?: string;
};

type BranchContextType = {
  branchId: string; // '' = all branches (admin only)
  setBranchId: (id: string) => void;
  branches: Branch[];
  loadingBranches: boolean;
  isBranchLocked: boolean;
};

const BranchContext = createContext<BranchContextType | undefined>(undefined);

const BRANCH_KEY = 'wb_active_branch_id';

function safeStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {}
  return null;
}

function pickErrorMessage(resp: any): string | null {
  if (!resp) return 'Request failed';
  if (resp.error) return String(resp.error);
  if (resp.success === false) return String(resp.error || resp.message || 'Request failed');
  if (resp?.data?.success === false) return String(resp?.data?.error || resp?.data?.message || 'Request failed');
  return null;
}

function unwrapArray<T>(resp: any): T[] {
  const root = resp?.data ?? resp;

  const arr = Array.isArray(root)
    ? root
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(root?.rows)
        ? root.rows
        : Array.isArray(root?.data?.rows)
          ? root.data.rows
          : [];

  return Array.isArray(arr) ? (arr as T[]) : [];
}

export function BranchProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();

  const role = (user?.role || (profile as any)?.role || 'operator') as Role;

  // branch_id can come from multiple shapes
  const fixedBranchId = String(
    (profile as any)?.branch_id ||
      (profile as any)?.branchId ||
      (user as any)?.branch_id ||
      (user as any)?.branchId ||
      ''
  );

  const storage = safeStorage();
  const isBranchLocked = role !== 'admin';

  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  const [branchId, setBranchIdState] = useState<string>(() => {
    // initial best-effort
    if (role !== 'admin') return fixedBranchId || '';
    return storage?.getItem(BRANCH_KEY) || '';
  });

  // ✅ prevent stale branchId closure inside async loaders
  const branchIdRef = useRef<string>(branchId);
  useEffect(() => {
    branchIdRef.current = branchId;
  }, [branchId]);

  const prevRoleRef = useRef<Role>(role);

  // ✅ Reset state on logout (avoid stale admin branch list in UI)
  useEffect(() => {
    if (user) return;
    setBranches([]);
    setLoadingBranches(false);
    setBranchIdState('');
  }, [user]);

  // handle role transition (ex: user loads and becomes admin)
  useEffect(() => {
    const prev = prevRoleRef.current;
    prevRoleRef.current = role;

    if (role === 'admin') {
      // restore saved selection for admin (if any)
      const saved = storage?.getItem(BRANCH_KEY) || '';
      setBranchIdState((cur) => cur || saved);
      return;
    }

    // non-admin: always lock to assigned branch
    setBranchIdState(fixedBranchId || '');

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = prev;
  }, [role, fixedBranchId]);

  function setBranchId(id: string) {
    const next = String(id || '');

    // non-admin must not change branch manually
    if (isBranchLocked) {
      setBranchIdState(fixedBranchId || '');
      return;
    }

    setBranchIdState(next);

    // ✅ do not store empty string; remove key instead
    if (storage) {
      if (!next) storage.removeItem(BRANCH_KEY);
      else storage.setItem(BRANCH_KEY, next);
    }
  }

  // Load branches for admin selector + refresh when branches change elsewhere
  useEffect(() => {
    if (role !== 'admin') return;
    if (typeof window === 'undefined') return;

    let cancelled = false;

    async function loadBranches() {
      setLoadingBranches(true);
      try {
        const r = await apiClient.get('/api/branches?limit=200');
        const err = pickErrorMessage(r);
        if (err) throw new Error(err);

        const list = unwrapArray<Branch>(r);
        if (!cancelled) setBranches(list);

        // if admin had a branch selected but it no longer exists → reset
        const selected = branchIdRef.current;
        if (!cancelled && selected) {
          const exists = list.some((b) => String(b.id) === String(selected));
          if (!exists) setBranchId('');
        }
      } catch {
        if (!cancelled) setBranches([]);
      } finally {
        if (!cancelled) setLoadingBranches(false);
      }
    }

    const onChanged = () => void loadBranches();

    window.addEventListener('wb:branches:changed', onChanged as any);
    void loadBranches();

    return () => {
      cancelled = true;
      window.removeEventListener('wb:branches:changed', onChanged as any);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const value = useMemo<BranchContextType>(
    () => ({
      branchId,
      setBranchId,
      branches,
      loadingBranches,
      isBranchLocked,
    }),
    [branchId, branches, loadingBranches, isBranchLocked]
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error('useBranch must be used within a BranchProvider');
  return ctx;
}
