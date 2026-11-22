const NAME_KEY = "axiom_guest_name";
const LEGACY_AVATAR_KEY = "axiom_guest_avatar";

export const guest = {
  get: (): string => {
    if (typeof window === "undefined") return "Guest";
    window.localStorage.removeItem(LEGACY_AVATAR_KEY);
    const stored = window.localStorage.getItem(NAME_KEY)?.trim();
    if (stored) return stored;
    const next = `Guest${Math.floor(1000 + Math.random() * 9000)}`;
    window.localStorage.setItem(NAME_KEY, next);
    return next;
  },
  set: (name: string) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(NAME_KEY, name);
  },
  clearAvatar: () => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(LEGACY_AVATAR_KEY);
  },
  clear: () => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(NAME_KEY);
    window.localStorage.removeItem(LEGACY_AVATAR_KEY);
  },
};
