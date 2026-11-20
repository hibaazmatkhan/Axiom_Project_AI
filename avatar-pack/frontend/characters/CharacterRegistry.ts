import type { CharacterId } from "../../contracts/avatar.types";
import { aguni } from "./roster/aguni";
import { ann } from "./roster/ann";
import { arisu } from "./roster/arisu";
import { banda } from "./roster/banda";
import { chishiya } from "./roster/chishiya";
import { chota } from "./roster/chota";
import { heiya } from "./roster/heiya";
import { karube } from "./roster/karube";
import { kuina } from "./roster/kuina";
import { kuzuryu } from "./roster/kuzuryu";
import { mira } from "./roster/mira";
import { niragi } from "./roster/niragi";
import { rei } from "./roster/rei";
import { shion } from "./roster/shion";
import { tatta } from "./roster/tatta";
import { usagi } from "./roster/usagi";
import type { CharacterSpec } from "./types";

export const CHARACTER_REGISTRY: Record<CharacterId, CharacterSpec> = {
  arisu,
  usagi,
  chishiya,
  kuina,
  ann,
  karube,
  chota,
  rei,
  niragi,
  aguni,
  banda,
  mira,
  tatta,
  shion,
  heiya,
  kuzuryu,
};

export const CHARACTER_IDS = Object.keys(CHARACTER_REGISTRY) as CharacterId[];

export const DEFAULT_CHARACTER_ID: CharacterId = "arisu";

export function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === "string" && (CHARACTER_IDS as readonly string[]).includes(value);
}

export function getCharacterSpec(id: CharacterId | null | undefined): CharacterSpec {
  return CHARACTER_REGISTRY[id ?? DEFAULT_CHARACTER_ID] ?? CHARACTER_REGISTRY[DEFAULT_CHARACTER_ID];
}
