import type { AvatarProfile, CharacterId, PfpPresetId } from "../../contracts/avatar.types";

export type AvatarApiOptions = {
  baseUrl?: string;
  tokenProvider?: () => string | null | Promise<string | null>;
  fetchImpl?: typeof fetch;
};

export class AvatarApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AvatarApiError";
    this.status = status;
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

export function createAvatarApi(options: AvatarApiOptions = {}) {
  const baseUrl = (options.baseUrl ?? "/backend").replace(/\/+$/, "");
  const tokenProvider = options.tokenProvider ?? (() => null);
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (authenticated) {
      const token = await tokenProvider();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers, cache: "no-store" });
    } catch {
      throw new AvatarApiError("Cannot reach the broadcast server.", 0);
    }

    if (!response.ok) {
      let detail = "The broadcast server rejected that request.";
      try {
        const body = (await response.json()) as { detail?: unknown };
        if (typeof body?.detail === "string") detail = body.detail;
      } catch {}
      throw new AvatarApiError(detail, response.status);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    presets: () =>
      request<{ presets: unknown[]; characters: CharacterId[] }>("/api/avatar/presets", {}, false),
    uploadPfp: async (file: File) => {
      const data = await fileToBase64(file);
      return request<AvatarProfile>("/api/avatar/pfp/upload", {
        method: "POST",
        body: JSON.stringify({ content_type: file.type, data }),
      });
    },
    selectPfpPreset: (presetId: PfpPresetId) =>
      request<AvatarProfile>("/api/avatar/pfp/preset", {
        method: "POST",
        body: JSON.stringify({ preset_id: presetId }),
      }),
    selectCharacter: (characterId: CharacterId) =>
      request<AvatarProfile>("/api/avatar/character", {
        method: "POST",
        body: JSON.stringify({ character_id: characterId }),
      }),
    updateUsername: (username: string) =>
      request<AvatarProfile>("/api/avatar/username", {
        method: "PUT",
        body: JSON.stringify({ username }),
      }),
  };
}

export const avatarApi = createAvatarApi();
