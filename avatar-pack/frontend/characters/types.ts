import type { Group } from "three";
import type { CharacterId, CharacterRuntimeState } from "../../contracts/avatar.types";

export type CharacterPalette = {
  primary: number;
  secondary: number;
  accent: number;
  skin: number;
  hair: number;
};

export type AccessoryKind =
  | "none"
  | "hood"
  | "headband"
  | "glasses"
  | "scarf"
  | "jacket"
  | "cape"
  | "mask"
  | "crown"
  | "earmuffs";

export type CharacterSpec = {
  id: CharacterId;
  name: string;
  palette: CharacterPalette;
  accessory: AccessoryKind;
  build: number;
  height: number;
};

export type CharacterParts = {
  root: Group;
  body: Group;
  head: Group;
  leftArm: Group;
  rightArm: Group;
  leftLeg: Group;
  rightLeg: Group;
};

export type CharacterModel = {
  group: Group;
  update: (deltaMs: number) => void;
  setFacing: (radians: number) => void;
  setState: (state: Partial<CharacterRuntimeState>) => void;
  dispose: () => void;
};
