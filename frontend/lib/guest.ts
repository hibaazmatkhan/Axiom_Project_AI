const GUEST_KEY = "axiom_guest_name";

export const guest = {
  get: (): string =>
    typeof window === "undefined" ? "" : localStorage.getItem(GUEST_KEY) ?? "",
  set: (name: string) => localStorage.setItem(GUEST_KEY, name),
  clear: () => localStorage.removeItem(GUEST_KEY),
};
