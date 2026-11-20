import * as THREE from "three";
import type { CharacterPalette } from "./types";

export type CharacterMaterials = {
  skin: THREE.MeshStandardMaterial;
  cloth: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
};

export function createCharacterMaterials(palette: CharacterPalette): CharacterMaterials {
  return {
    skin: new THREE.MeshStandardMaterial({ color: palette.skin, roughness: 0.82, metalness: 0.02 }),
    cloth: new THREE.MeshStandardMaterial({ color: palette.primary, roughness: 0.68, metalness: 0.08 }),
    trim: new THREE.MeshStandardMaterial({ color: palette.secondary, roughness: 0.62, metalness: 0.12 }),
    accent: new THREE.MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 0.25,
      roughness: 0.45,
      metalness: 0.3,
    }),
    hair: new THREE.MeshStandardMaterial({ color: palette.hair, roughness: 0.9, metalness: 0.01 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.55, metalness: 0.28 }),
    glow: new THREE.MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 1.2,
      roughness: 0.3,
      metalness: 0.2,
    }),
  };
}

export function disposeCharacterMaterials(materials: CharacterMaterials): void {
  Object.values(materials).forEach((material) => material.dispose());
}
