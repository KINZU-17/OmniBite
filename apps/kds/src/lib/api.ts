export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** Staff-authenticated fetch. Phase 1 auth is the x-staff-id header. */
export async function api<T = unknown>(
  path: string,
  staffId: string,
  opts: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', 'x-staff-id': staffId, ...(opts.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
