import type { CharacterRuntimeState } from "../../contracts/avatar.types";
import type { CharacterMaterials } from "./CharacterMaterials";
import type { CharacterParts, CharacterSpec } from "./types";

export type CharacterAnimator = {
  update: (deltaMs: number, state: CharacterRuntimeState) => void;
};

export function createCharacterAnimator(
  spec: CharacterSpec,
  parts: CharacterParts,
  materials: CharacterMaterials
): CharacterAnimator {
  let elapsed = 0;

  return {
    update(deltaMs, state) {
      elapsed += Math.min(deltaMs, 100);
      const t = elapsed / 1000;
      const bounce = Math.sin(t * 2.4 + spec.name.length) * 0.018;
      const stride = state.moving && state.connected ? Math.sin(t * 9) * 0.5 : 0;
      const slump = state.eliminated ? -0.42 : 0;

      parts.body.position.y = bounce + (state.ready ? 0.03 : 0);
      parts.body.rotation.z = slump;
      parts.body.rotation.y = Math.sin(t * 1.2) * 0.04;
      parts.head.rotation.z = state.locked ? Math.sin(t * 7) * 0.06 : 0;
      parts.leftArm.rotation.x = stride;
      parts.rightArm.rotation.x = -stride;
      parts.leftLeg.rotation.x = -stride * 0.7;
      parts.rightLeg.rotation.x = stride * 0.7;
      parts.root.visible = state.connected || state.eliminated || state.escaped;

      materials.accent.emissiveIntensity = state.locked
        ? 1.4 + Math.sin(t * 8) * 0.5
        : state.escaped
          ? 1.1
          : 0.25;
      materials.glow.emissiveIntensity = state.eliminated ? 0.1 : 1.2 + Math.sin(t * 3) * 0.2;
      materials.cloth.color.multiplyScalar(1);
    },
  };
}
