const NAME_KEY = "axiom_guest_name";
const LEGACY_AVATAR_KEY = "axiom_guest_avatar";

export const guest = {
  get: (): string => {
    if (typeof window === "undefined") return "";
    window.localStorage.removeItem(LEGACY_AVATAR_KEY);
    return window.localStorage.getItem(NAME_KEY) ?? "";
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
