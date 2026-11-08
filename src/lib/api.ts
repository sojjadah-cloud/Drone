import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { Permission, UserDTO } from '@shared/domain';

export class ApiError extends Error {
  status: number;
  code: string;
  body: any;
  constructor(status: number, body: any) {
    super(body?.error ?? `http_${status}`);
    this.status = status;
    this.code = body?.error ?? (status === 0 ? 'network' : 'internal');
    this.body = body;
  }
}

interface AuthState {
  user: UserDTO | null;
  csrf: string | null;
  permissions: Permission[];
  checked: boolean;
  set: (s: Partial<AuthState>) => void;
}
export const useAuth = create<AuthState>((set) => ({
  user: null,
  csrf: null,
  permissions: [],
  checked: false,
  set: (s) => set(s),
}));
export const useCan = () => {
  const perms = useAuth((s) => s.permissions);
  return (p: Permission) => perms.includes(p);
};

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };
  const method = opts.method ?? (opts.body || opts.form ? 'POST' : 'GET');
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const csrf = useAuth.getState().csrf;
  if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, { error: 'network' });
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: 'internal' };
  }
  if (!res.ok) {
    if (res.status === 401 && useAuth.getState().user) useAuth.getState().set({ user: null, csrf: null, permissions: [] });
    throw new ApiError(res.status, body);
  }
  return body as T;
}

// -----------------------------------------------------------------------------
// Tiny invalidation bus: realtime messages invalidate topics, queries refetch.
// -----------------------------------------------------------------------------
type Topic = 'incidents' | 'reports' | 'missions' | 'drones' | 'assessments' | 'suppressions' | 'notifications' | 'users' | 'simulator';
const listeners = new Map<Topic, Set<() => void>>();
export function invalidate(...topics: Topic[]) {
  for (const t of topics) listeners.get(t)?.forEach((f) => f());
}
function subscribe(topics: Topic[], fn: () => void) {
  for (const t of topics) {
    if (!listeners.has(t)) listeners.set(t, new Set());
    listeners.get(t)!.add(fn);
  }
  return () => topics.forEach((t) => listeners.get(t)?.delete(fn));
}

export function useQuery<T>(path: string | null, topics: Topic[] = [], { throttleMs = 600 } = {}) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const pathRef = useRef(path);
  pathRef.current = path;
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const d = await api<T>(p);
      if (pathRef.current === p) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (pathRef.current === p) setError(e as ApiError);
    } finally {
      if (pathRef.current === p) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!path) {
      setData(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    load();
  }, [path, load]);

  const topicKey = topics.join(',');
  useEffect(() => {
    if (!topicKey) return;
    return subscribe(topicKey.split(',') as Topic[], () => {
      if (timer.current) return;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        load();
      }, throttleMs);
    });
  }, [topicKey, load, throttleMs]);

  return { data, error, loading: loading && data === undefined, refetch: load, setData };
}
