import { getFirebaseAuth } from "./firebase";

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
  [key: string]: unknown;
};

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

async function token(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    return (await getFirebaseAuth().currentUser?.getIdToken(true)) ?? null;
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
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const idToken = authenticated ? await token() : null;
  if (idToken) headers.set("Authorization", `Bearer ${idToken}`);

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { ...init, headers, cache: "no-store" });
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
  health: async (): Promise<{ ok: boolean; rooms: number; players: number } | null> => {
    try {
      return await request<{ ok: boolean; rooms: number; players: number }>(
        "/health",
        {},
        false
      );
    } catch {
      return null;
    }
  },
};
