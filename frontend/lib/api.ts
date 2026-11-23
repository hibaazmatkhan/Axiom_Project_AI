import type { PfpPresetId } from "./avatarRules";
import { appCheckToken, getFirebaseAuth } from "./firebase";

const API = "/backend";

export type PublicUser = {
  uid: string;
  email: string | null;
  email_verified: boolean;
  display_name: string | null;
  photo_url: string | null;
};

export type Profile = {
  id: string;
  email: string | null;
  username: string;
  display_name: string;
  avatar_url: string | null;
  has_custom_avatar: boolean;
  email_verified: boolean;
  mfa_enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type PlayerStats = {
  matches?: number;
  escapes?: number;
  accuracy?: number;
  style?: string | null;
  attributes?: Record<string, number>;
  [key: string]: unknown;
};

export type MatchRecord = {
  id: number;
  room: string;
  cycles: number;
  duration: number;
  team_skill?: number;
  winner?: boolean;
  [key: string]: unknown;
};

export type Leader = {
  username: string;
  matches: number;
  pattern?: number;
  avatar_url?: string | null;
  [key: string]: unknown;
};

export type RoomInfo = {
  room_id: string;
  code: string;
  status: string;
  players: unknown[];
  connected: number;
  full?: boolean;
  started?: boolean;
  joinable?: boolean;
  instance_id?: string;
};

export type QuickMatchStatus = {
  status: "queued" | "matched";
  position?: number;
  code?: string;
  instance_id?: string;
};

export function canonicalRoomCode(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4);
}

export type MeResponse = {
  user: PublicUser;
  profile: Profile;
  stats: PlayerStats;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function token(forceRefresh = false): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    return (await getFirebaseAuth().currentUser?.getIdToken(forceRefresh)) ?? null;
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  authenticated = true
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const idToken = authenticated ? await token() : null;
  if (idToken) headers.set("Authorization", `Bearer ${idToken}`);
  if (authenticated) {
    const appCheck = await appCheckToken();
    if (appCheck) headers.set("X-Firebase-AppCheck", appCheck);
  }

  const send = (requestHeaders: Headers): Promise<Response> =>
    fetch(`${API}${path}`, { ...init, headers: requestHeaders, cache: "no-store" });

  let response: Response;
  try {
    response = await send(headers);
    if (response.status === 401 && authenticated) {
      const refreshed = await token(true);
      if (refreshed && refreshed !== idToken) {
        const retryHeaders = new Headers(headers);
        retryHeaders.set("Authorization", `Bearer ${refreshed}`);
        response = await send(retryHeaders);
      }
    }
  } catch {
    throw new ApiError("Cannot reach the broadcast server.", 0);
  }

  if (!response.ok) {
    let detail = "The broadcast server rejected that request.";
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // Keep the fallback message.
    }
    throw new ApiError(detail, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  me: () => request<MeResponse>("/api/me"),
  updateProfile: (payload: { username: string; display_name?: string | null }) =>
    request<{ profile: Profile; stats: PlayerStats }>("/api/me/profile", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  selectPfpPreset: (presetId: PfpPresetId) =>
    request<{ profile: Profile }>("/api/me/avatar/preset", {
      method: "PUT",
      body: JSON.stringify({ preset_id: presetId }),
    }),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ profile: Profile }>("/api/me/avatar/upload", {
      method: "POST",
      body: form,
    });
  },
  deleteAvatar: () =>
    request<{ profile: Profile }>("/api/me/avatar", { method: "DELETE" }),
  exportData: () => request<Record<string, unknown>>("/api/me/export"),
  deleteAccount: () => request<{ ok: boolean }>("/api/me", { method: "DELETE" }),
  setMfa: (enabled: boolean) =>
    request<{ profile: Profile }>("/api/me/mfa", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
  history: (limit = 20) =>
    request<{ matches: MatchRecord[]; username: string }>(
      `/api/me/history?limit=${encodeURIComponent(String(limit))}`
    ),
  leaderboard: (limit = 10) =>
    request<{ leaders: Leader[] }>(
      `/api/leaderboard?limit=${encodeURIComponent(String(limit))}`,
      {},
      false
    ),
  stages: () => request<{ stages: unknown[]; max: number }>("/api/stages", {}, false),
  createRoom: (minPlayers?: number) =>
    request<{ room_id: string; code: string; instance_id?: string }>("/api/rooms", {
      method: "POST",
      body: JSON.stringify(minPlayers === undefined ? {} : { min_players: minPlayers }),
    }),
  getRoom: (code: string) =>
    request<RoomInfo>(`/api/rooms/${encodeURIComponent(canonicalRoomCode(code))}`),
  quickMatch: (clientKey: string) =>
    request<QuickMatchStatus>("/api/rooms/quick-match", {
      method: "POST",
      body: JSON.stringify({ client_key: clientKey }),
    }),
  quickMatchStatus: (clientKey: string) =>
    request<QuickMatchStatus>(
      `/api/rooms/quick-match/${encodeURIComponent(clientKey)}`
    ),
  health: async (): Promise<{ ok: boolean; rooms: number; players: number; instance_id?: string } | null> => {
    try {
      return await request<{ ok: boolean; rooms: number; players: number; instance_id?: string }>(
        "/health",
        {},
        false
      );
    } catch {
      return null;
    }
  },
};
