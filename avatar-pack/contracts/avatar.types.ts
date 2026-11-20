export type PfpPresetId = "joker" | "spade" | "club" | "heart" | "diamond";

export type CharacterId =
  | "arisu"
  | "usagi"
  | "chishiya"
  | "kuina"
  | "ann"
  | "karube"
  | "chota"
  | "rei"
  | "niragi"
  | "aguni"
  | "banda"
  | "mira"
  | "tatta"
  | "shion"
  | "heiya"
  | "kuzuryu";

export type AvatarPreset = {
  id: PfpPresetId;
  label: string;
  glyph: string;
  src: string;
};

export type AvatarProfile = {
  username: string;
  avatar_url: string | null;
  avatar_preset_id: PfpPresetId | null;
  character_id: CharacterId | null;
};

export type AvatarSelection = {
  avatarUrl: string | null;
  avatarPresetId: PfpPresetId | null;
  characterId: CharacterId | null;
};

export type GuestIdentity = {
  name: string;
  pfpPresetId: PfpPresetId | null;
  characterId: CharacterId;
  customPfpKey: string | null;
  updatedAt: number;
};

export type CharacterRuntimeState = {
  locked: boolean;
  eliminated: boolean;
  escaped: boolean;
  connected: boolean;
  ready: boolean;
  moving: boolean;
};
