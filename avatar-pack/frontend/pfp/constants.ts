export const MAX_PFP_BYTES = 2 * 1024 * 1024;

export const ALLOWED_PFP_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const GUEST_STORAGE_KEY = "axiom_guest_identity_v1";

export const GUEST_DB_NAME = "axiom_avatar_pack";

export const GUEST_STORE_NAME = "guest_pfps";

export function isAllowedPfpType(value: string): boolean {
  return (ALLOWED_PFP_TYPES as readonly string[]).includes(value);
}
