export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** Thin fetch wrapper that throws on non-2xx and parses JSON. */
export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
