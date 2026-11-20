import type { Group } from "three";
import type { CharacterRuntimeState } from "../../contracts/avatar.types";
import { addCharacterAccessories } from "./CharacterAccessories";
import { createCharacterAnimator } from "./CharacterAnimations";
import { createCharacterBase } from "./CharacterBase";
import { createCharacterMaterials, disposeCharacterMaterials } from "./CharacterMaterials";
import type { CharacterModel, CharacterSpec } from "./types";

const INITIAL_STATE: CharacterRuntimeState = {
  locked: false,
  eliminated: false,
  escaped: false,
  connected: true,
  ready: false,
  moving: false,
};

export function createCharacterModel(
  spec: CharacterSpec,
  initial: Partial<CharacterRuntimeState> = {}
): CharacterModel {
  const state: CharacterRuntimeState = { ...INITIAL_STATE, ...initial };
  const materials = createCharacterMaterials(spec.palette);
  const parts = createCharacterBase(spec, materials);
  addCharacterAccessories(spec, materials, parts);
  const animator = createCharacterAnimator(spec, parts, materials);
  const group: Group = parts.root;

  return {
    group,
    update(deltaMs) {
      animator.update(deltaMs, state);
    },
    setFacing(radians) {
      group.rotation.y = radians;
    },
    setState(patch) {
      Object.assign(state, patch);
    },
    dispose() {
      group.traverse((object) => {
        const candidate = object as { geometry?: { dispose: () => void } };
        candidate.geometry?.dispose();
      });
      disposeCharacterMaterials(materials);
    },
  };
}
