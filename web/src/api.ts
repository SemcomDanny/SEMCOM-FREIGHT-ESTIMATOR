export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep the status text */
    }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  del: <T,>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/* Shared response shapes ------------------------------------------- */

export interface Lane {
  id: string;
  origin_port: string;
  destination_port: string;
  active: number;
  rate_versions?: number;
}

export interface ContainerTypeRow {
  id: string;
  name: string;
  int_l_mm: number;
  int_w_mm: number;
  int_h_mm: number;
  max_payload_kg: number;
  active: number;
}

export interface PalletTypeRow {
  id: string;
  name: string;
  l_mm: number;
  w_mm: number;
  deck_h_mm: number;
  max_load_h_mm: number;
  max_load_kg: number;
  overhang_mm: number;
  active: number;
}

export interface RateCardRow {
  id: string;
  lane_id: string;
  mode: 'LCL' | 'FCL' | 'AIR';
  currency: string;
  fx_to_aud: number;
  effective_from: string;
  entered_by: string | null;
  entered_by_name: string | null;
  entered_at: string;
  note: string | null;
  superseded_by: string | null;
}

export interface AppSettings {
  stowEfficiency: number;
  staleRateDays: number;
  defaultDutyPct: number;
  defaultGstPct: number;
  palletTareKg: number;
}
