import { isPfpPresetId, type PfpPresetId } from "./avatarRules";

const NAME_KEY = "axiom_guest_name";
const PFP_KEY = "axiom_guest_pfp";
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
  getPfp: (): PfpPresetId => {
    if (typeof window === "undefined") return "joker";
    window.localStorage.removeItem(LEGACY_AVATAR_KEY);
    const stored = window.localStorage.getItem(PFP_KEY);
    return isPfpPresetId(stored) ? stored : "joker";
  },
  setPfp: (id: unknown) => {
    if (typeof window === "undefined" || !isPfpPresetId(id)) return;
    window.localStorage.setItem(PFP_KEY, id);
  },
  clearAvatar: () => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(PFP_KEY);
    window.localStorage.removeItem(LEGACY_AVATAR_KEY);
  },
  clear: () => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(NAME_KEY);
    window.localStorage.removeItem(PFP_KEY);
    window.localStorage.removeItem(LEGACY_AVATAR_KEY);
  },
};
