import type { AvatarPreset, PfpPresetId } from "../../contracts/avatar.types";

export const PFP_PRESETS: AvatarPreset[] = [
  { id: "joker", label: "Joker", glyph: "JKR", src: "/avatars/pfp/joker.png" },
  { id: "spade", label: "Spade", glyph: "SPADE", src: "/avatars/pfp/spade.png" },
  { id: "club", label: "Club", glyph: "CLUB", src: "/avatars/pfp/club.png" },
  { id: "heart", label: "Heart", glyph: "HEART", src: "/avatars/pfp/heart.png" },
  { id: "diamond", label: "Diamond", glyph: "DIAMOND", src: "/avatars/pfp/diamond.png" },
];

export const PFP_PRESET_IDS = PFP_PRESETS.map((preset) => preset.id);

export function isPfpPresetId(value: unknown): value is PfpPresetId {
  return typeof value === "string" && PFP_PRESET_IDS.includes(value as PfpPresetId);
}

export function getPfpPreset(id: PfpPresetId | null | undefined): AvatarPreset | null {
  return PFP_PRESETS.find((preset) => preset.id === id) ?? null;
}
