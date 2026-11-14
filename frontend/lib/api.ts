const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export const api = {
  signup: (username: string, password: string) =>
    post<{ ok: boolean; error: string | null }>("/api/signup", { username, password }),
  login: (username: string, password: string) =>
    post<{ ok: boolean; error: string | null }>("/api/login", { username, password }),
  profile: (username: string) => get<any>(`/api/profile/${encodeURIComponent(username)}`),
  history: (username: string) => get<{ matches: any[] }>(`/api/history/${encodeURIComponent(username)}`),
  leaderboard: () => get<{ leaders: any[] }>("/api/leaderboard"),
  stages: () => get<{ stages: any[]; max: number }>("/api/stages"),
  health: () => get<{ ok: boolean; rooms: number; players: number }>("/health"),
};

const KEY = "lastroom_user";
export const auth = {
  current: (): string | null =>
    typeof window === "undefined" ? null : localStorage.getItem(KEY),
  set: (u: string) => localStorage.setItem(KEY, u),
  clear: () => localStorage.removeItem(KEY),
};
