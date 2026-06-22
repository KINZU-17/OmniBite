export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** Thin fetch wrapper that throws on non-2xx and parses JSON. */
export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  // Spread opts first, then headers — otherwise a caller passing its own headers
  // (e.g. x-staff-id) would clobber the Content-Type and the JSON body wouldn't
  // be parsed server-side.
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
