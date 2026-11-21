export const PFP_PRESET_IDS = ["joker", "spade", "club", "heart", "diamond"] as const;

export type PfpPresetId = (typeof PFP_PRESET_IDS)[number];

export type PfpPreset = {
  id: PfpPresetId;
  label: string;
  src: string;
};

export const PFP_PRESETS: PfpPreset[] = [
  { id: "joker", label: "Joker", src: "/avatars/pfp/joker.png" },
  { id: "spade", label: "Spade", src: "/avatars/pfp/spade.png" },
  { id: "club", label: "Club", src: "/avatars/pfp/club.png" },
  { id: "heart", label: "Heart", src: "/avatars/pfp/heart.png" },
  { id: "diamond", label: "Diamond", src: "/avatars/pfp/diamond.png" },
];

export const PFP_SUITS: Record<PfpPresetId, string> = {
  joker: "★",
  spade: "♠",
  club: "♣",
  heart: "♥",
  diamond: "♦",
};

export const PFP_TONES: Record<PfpPresetId, string> = {
  joker: "#e0af68",
  spade: "#7aa2f7",
  club: "#9ece6a",
  heart: "#f7768e",
  diamond: "#7dcfff",
};

export const ALLOWED_AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export function isPfpPresetId(value: unknown): value is PfpPresetId {
  return typeof value === "string" && (PFP_PRESET_IDS as readonly string[]).includes(value);
}

export function pfpPresetUrl(id: PfpPresetId): string {
  return `/avatars/pfp/${id}.png`;
}

export function pfpPresetFromUrl(url: string | null | undefined): PfpPresetId | null {
  if (!url) return null;
  const match = /^\/avatars\/pfp\/([a-z]+)\.png$/.exec(url);
  return match && isPfpPresetId(match[1]) ? match[1] : null;
}

export function assertAvatarType(file: File): void {
  if (!(ALLOWED_AVATAR_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("Use a PNG, JPEG or WEBP image.");
  }
}
