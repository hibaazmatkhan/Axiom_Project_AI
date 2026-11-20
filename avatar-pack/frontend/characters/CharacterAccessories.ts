import * as THREE from "three";
import type { CharacterMaterials } from "./CharacterMaterials";
import type { CharacterParts, CharacterSpec } from "./types";

function addMesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.castShadow = true;
  parent.add(result);
  return result;
}

export function addCharacterAccessories(
  spec: CharacterSpec,
  materials: CharacterMaterials,
  parts: CharacterParts
): void {
  const s = spec.height;
  const b = spec.build;

  if (spec.accessory === "hood") {
    const hood = addMesh(parts.head, new THREE.ConeGeometry(0.34 * b, 0.42 * s, 7), materials.cloth);
    hood.position.y = 0.2;
    const rim = addMesh(parts.head, new THREE.TorusGeometry(0.27 * b, 0.045, 5, 10), materials.trim);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.06;
  } else if (spec.accessory === "headband") {
    const band = addMesh(parts.head, new THREE.TorusGeometry(0.29 * b, 0.035, 5, 12), materials.accent);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.1;
    const tail = addMesh(parts.head, new THREE.BoxGeometry(0.06, 0.22, 0.03), materials.accent);
    tail.position.set(0.27 * b, 0.02, -0.05);
  } else if (spec.accessory === "glasses") {
    const lensGeometry = new THREE.TorusGeometry(0.085, 0.018, 5, 10);
    const left = addMesh(parts.head, lensGeometry, materials.dark);
    left.position.set(-0.1, 0.02, 0.26);
    const right = addMesh(parts.head, lensGeometry, materials.dark);
    right.position.set(0.1, 0.02, 0.26);
    const bridge = addMesh(parts.head, new THREE.BoxGeometry(0.12, 0.02, 0.02), materials.dark);
    bridge.position.set(0, 0.02, 0.26);
  } else if (spec.accessory === "scarf") {
    const wrap = addMesh(parts.body, new THREE.TorusGeometry(0.31 * b, 0.07, 5, 10), materials.accent);
    wrap.rotation.x = Math.PI / 2;
    wrap.position.y = 1.17 * s;
    const tail = addMesh(parts.body, new THREE.BoxGeometry(0.1, 0.36 * s, 0.05), materials.accent);
    tail.position.set(0.24 * b, 0.96 * s, 0.18);
    tail.rotation.z = -0.18;
  } else if (spec.accessory === "jacket") {
    const left = addMesh(parts.body, new THREE.BoxGeometry(0.16 * b, 0.62 * s, 0.12), materials.trim);
    left.position.set(-0.34 * b, 0.7 * s, 0.2);
    const right = addMesh(parts.body, new THREE.BoxGeometry(0.16 * b, 0.62 * s, 0.12), materials.trim);
    right.position.set(0.34 * b, 0.7 * s, 0.2);
    const stripe = addMesh(parts.body, new THREE.BoxGeometry(0.06, 0.58 * s, 0.04), materials.accent);
    stripe.position.set(0, 0.72 * s, 0.29);
  } else if (spec.accessory === "cape") {
    const cape = addMesh(parts.body, new THREE.ConeGeometry(0.52 * b, 0.9 * s, 6, 1, true), materials.trim);
    cape.position.set(0, 0.72 * s, -0.18);
    cape.rotation.x = -0.12;
    cape.material = materials.cloth;
  } else if (spec.accessory === "mask") {
    const mask = addMesh(parts.head, new THREE.BoxGeometry(0.32 * b, 0.17, 0.05), materials.dark);
    mask.position.set(0, -0.03, 0.26);
    const band = addMesh(parts.head, new THREE.BoxGeometry(0.34 * b, 0.035, 0.05), materials.accent);
    band.position.set(0, 0.1, 0.26);
  } else if (spec.accessory === "crown") {
    const rim = addMesh(parts.head, new THREE.CylinderGeometry(0.29 * b, 0.29 * b, 0.08, 8), materials.accent);
    rim.position.y = 0.25;
    for (let i = 0; i < 5; i += 1) {
      const spike = addMesh(parts.head, new THREE.ConeGeometry(0.06, 0.16, 4), materials.accent);
      const angle = (i / 5) * Math.PI * 2;
      spike.position.set(Math.cos(angle) * 0.23 * b, 0.35, Math.sin(angle) * 0.23 * b);
    }
  } else if (spec.accessory === "earmuffs") {
    const left = addMesh(parts.head, new THREE.SphereGeometry(0.1, 6, 5), materials.accent);
    left.position.set(-0.3 * b, 0.04, 0);
    const right = addMesh(parts.head, new THREE.SphereGeometry(0.1, 6, 5), materials.accent);
    right.position.set(0.3 * b, 0.04, 0);
    const arc = addMesh(parts.head, new THREE.TorusGeometry(0.3 * b, 0.025, 5, 12, Math.PI), materials.trim);
    arc.rotation.z = Math.PI;
    arc.position.y = 0.13;
  }
}
