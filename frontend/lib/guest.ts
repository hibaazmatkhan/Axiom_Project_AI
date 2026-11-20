const GUEST_KEY = "axiom_guest_name";
const AVATAR_KEY = "axiom_guest_avatar";

export type GuestAvatar = {
  character_id?: string | null;
  avatar_url?: string | null;
};

function read(): GuestAvatar {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(AVATAR_KEY);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return {};
    const avatar = value as GuestAvatar;
    return {
      character_id: typeof avatar.character_id === "string" ? avatar.character_id : null,
      avatar_url: typeof avatar.avatar_url === "string" ? avatar.avatar_url : null,
    };
  } catch {
    return {};
  }
}

export const guest = {
  get: (): string =>
    typeof window === "undefined" ? "" : localStorage.getItem(GUEST_KEY) ?? "",
  set: (name: string) => localStorage.setItem(GUEST_KEY, name),
  getAvatar: (): GuestAvatar => read(),
  setAvatar: (avatar: GuestAvatar) => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(AVATAR_KEY, JSON.stringify(avatar));
    } catch {
      return;
    }
  },
  clearAvatar: () => {
    if (typeof window === "undefined") return;
    try {
      localStorage.removeItem(AVATAR_KEY);
    } catch {
      return;
    }
  },
  clear: () => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(GUEST_KEY);
    localStorage.removeItem(AVATAR_KEY);
  },
};
