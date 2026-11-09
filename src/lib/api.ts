import { useSyncExternalStore } from 'react';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// Pilot session token (signed by the server, 12 h). Kept per browser tab.
const KEY = 'resqair.token';
const listeners = new Set<() => void>();
const read = () => {
  try {
    const t = sessionStorage.getItem(KEY);
    return t && Number(t.split('.')[0]) > Date.now() ? t : null;
  } catch {
    return null;
  }
};
export function setToken(t: string | null) {
  try {
    if (t) sessionStorage.setItem(KEY, t);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((f) => f());
}
export const useToken = () =>
  useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), read, () => null);

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const t = read();
  if (t) headers.authorization = `Bearer ${t}`;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: body !== undefined ? 'POST' : 'GET', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'network');
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON (e.g. a static host's 404 page) means the API is not deployed.
    throw new ApiError(res.status, res.ok ? 'internal' : 'api_unavailable');
  }
  if (!res.ok) {
    if (res.status === 401 && t) setToken(null);
    throw new ApiError(res.status, data?.error ?? 'internal');
  }
  return data as T;
}
