import * as THREE from "three";
import type { CharacterMaterials } from "./CharacterMaterials";
import type { CharacterParts, CharacterSpec } from "./types";

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

export function createCharacterBase(spec: CharacterSpec, materials: CharacterMaterials): CharacterParts {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const head = new THREE.Group();
  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  const leftLeg = new THREE.Group();
  const rightLeg = new THREE.Group();

  const width = 0.42 * spec.build;
  const torsoHeight = 0.66 * spec.height;
  const torso = mesh(new THREE.CylinderGeometry(width * 0.82, width, torsoHeight, 6, 1), materials.cloth);
  torso.position.y = 0.72 * spec.height;
  body.add(torso);

  const chest = mesh(new THREE.BoxGeometry(width * 1.45, 0.14, 0.1), materials.trim);
  chest.position.set(0, 0.98 * spec.height, 0.27);
  body.add(chest);

  const collar = mesh(new THREE.CylinderGeometry(width * 0.52, width * 0.52, 0.09, 6), materials.accent);
  collar.position.y = 1.12 * spec.height;
  body.add(collar);

  const skull = mesh(new THREE.DodecahedronGeometry(0.27 * spec.build, 0), materials.skin);
  skull.scale.y = 1.08;
  head.add(skull);

  const hairCap = mesh(new THREE.SphereGeometry(0.285 * spec.build, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.52), materials.hair);
  hairCap.position.y = 0.06;
  head.add(hairCap);

  const eyeMaterial = materials.dark;
  const eyeGeometry = new THREE.BoxGeometry(0.045, 0.035, 0.02);
  const leftEye = mesh(eyeGeometry, eyeMaterial);
  leftEye.position.set(-0.09, 0.01, 0.25);
  const rightEye = mesh(eyeGeometry, eyeMaterial);
  rightEye.position.set(0.09, 0.01, 0.25);
  head.add(leftEye, rightEye);
  head.position.y = 1.43 * spec.height;

  const armGeometry = new THREE.CylinderGeometry(0.075, 0.065, 0.52 * spec.height, 5);
  const armLeft = mesh(armGeometry, materials.trim);
  armLeft.position.y = -0.26 * spec.height;
  leftArm.add(armLeft);
  leftArm.position.set(-width * 1.16, 0.96 * spec.height, 0);

  const armRight = mesh(armGeometry, materials.trim);
  armRight.position.y = -0.26 * spec.height;
  rightArm.add(armRight);
  rightArm.position.set(width * 1.16, 0.96 * spec.height, 0);

  const legGeometry = new THREE.CylinderGeometry(0.09, 0.075, 0.5 * spec.height, 5);
  const legLeft = mesh(legGeometry, materials.dark);
  legLeft.position.y = -0.25 * spec.height;
  leftLeg.add(legLeft);
  leftLeg.position.set(-width * 0.48, 0.4 * spec.height, 0);

  const legRight = mesh(legGeometry, materials.dark);
  legRight.position.y = -0.25 * spec.height;
  rightLeg.add(legRight);
  rightLeg.position.set(width * 0.48, 0.4 * spec.height, 0);

  const base = mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.08, 12), materials.accent);
  base.position.y = 0.04;
  base.material = materials.dark;
  root.add(base);

  body.add(head, leftArm, rightArm);
  root.add(body, leftLeg, rightLeg);
  return { root, body, head, leftArm, rightArm, leftLeg, rightLeg };
}
