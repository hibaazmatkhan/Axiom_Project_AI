"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Arena, Dice, Direction, Door, DoorColor, Player, Role, Visions, You } from "@/lib/types";

type Props = {
  arena: Arena | null;
  you: You | null;
  players: Player[];
  youId: string | null;
  role: Role;
  dice: Dice;
  futures: Visions;
  exitUnsealed: boolean;
  transitionId: number;
  moved: { from: [number, number]; to: [number, number]; code_from: string; code_to: string }[];
  firstPerson: boolean;
  onChooseDoor: (dir: Direction) => void;
};

const H = 3;
const WH = 3.2;
const DW = 1.7;
const DH = 2.5;
const T = 0.22;

const INK = 0x0b0c0e;
const WHITE = 0xf4f1ea;
const DOOR_HEX: Record<DoorColor, number> = {
  red: 0xe23b3b, blue: 0x3f7bd9, yellow: 0xe8b53a, green: 0x3f9f6b,
};
const FUTURE_HEX: Record<string, number> = {
  exit: 0xe8b53a, sanction: 0xe23b3b, open: 0x3f9f6b, void: 0x3a3d42, unknown: 0x6f7680,
};
const SIGIL_GLYPH: Record<string, string> = {
  spade: "\u2660", heart: "\u2665", diamond: "\u2666", club: "\u2663",
};
const DIRS: Direction[] = ["N", "E", "S", "W"];

function disposeGroup(group: THREE.Object3D) {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
    for (const m of mats) if (!m.userData?.shared) m.dispose();
    const sprite = obj as THREE.Sprite;
    const smap = (sprite.material as THREE.SpriteMaterial | undefined)?.map;
    if (smap) smap.dispose();
  });
}

function makeLabel(text: string, color = "#f4f1ea", scale = 1.5) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(11,12,14,0.82)";
  ctx.fillRect(8, 14, 240, 68);
  ctx.strokeStyle = "rgba(244,241,234,0.22)";
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 14, 240, 68);
  ctx.font = "bold 42px ui-monospace, monospace";
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scale, scale * 0.375, 1);
  return sprite;
}

function orientTo(group: THREE.Object3D, dir: Direction) {
  if (dir === "N") { group.position.set(0, 0, -H); group.rotation.y = 0; }
  else if (dir === "S") { group.position.set(0, 0, H); group.rotation.y = Math.PI; }
  else if (dir === "E") { group.position.set(H, 0, 0); group.rotation.y = -Math.PI / 2; }
  else { group.position.set(-H, 0, 0); group.rotation.y = Math.PI / 2; }
}

export default function GameCanvas(props: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const apiRef = useRef<{ rebuild: () => void; pulse: () => void } | null>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(INK);
    scene.fog = new THREE.Fog(INK, 8, 26);

    const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 120);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1c20, 1.05));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(3, 9, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const centerLight = new THREE.PointLight(0xfff2d8, 22, 14, 2);
    centerLight.position.set(0, WH - 0.4, 0);
    scene.add(centerLight);
    const glowLight = new THREE.PointLight(0xbfd4ff, 8, 12, 2);
    glowLight.position.set(0, 1.2, 0);
    scene.add(glowLight);

    const roomGroup = new THREE.Group();
    scene.add(roomGroup);

    const pickMeshes: THREE.Mesh[] = [];
    const diceGems: { mesh: THREE.Mesh; base: number; phase: number }[] = [];
    let glitch = 0;

    const wallMat = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.92, metalness: 0.02 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xe7e3da, roughness: 0.95 });
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0xdfdbd2, roughness: 1.0 });
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x050506 });
    for (const m of [wallMat, floorMat, ceilMat, voidMat]) m.userData.shared = true;

    const addBox = (
      parent: THREE.Object3D, w: number, h: number, d: number,
      x: number, y: number, z: number, mat: THREE.Material,
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    const buildWall = (dir: Direction, door?: Door & { open?: boolean }) => {
      const group = new THREE.Group();
      const side = H - DW / 2;
      const sideC = (H + DW / 2) / 2;
      addBox(group, side, WH, T, -sideC, WH / 2, 0, wallMat);
      addBox(group, side, WH, T, sideC, WH / 2, 0, wallMat);
      addBox(group, DW, WH - DH, T, 0, (DH + WH) / 2, 0, wallMat);

      const color: DoorColor = door?.color ?? "red";
      const sealed = !!door?.sealed;
      const open = !!door?.open && !sealed;
      const hex = sealed ? 0xe23b3b : DOOR_HEX[color] ?? 0xe23b3b;

      const frameMat = new THREE.MeshStandardMaterial({
        color: hex, emissive: hex, emissiveIntensity: sealed ? 1.5 : 0.85,
        roughness: 0.35, metalness: 0.45,
      });
      addBox(group, 0.1, DH, T + 0.08, -DW / 2, DH / 2, 0, frameMat);
      addBox(group, 0.1, DH, T + 0.08, DW / 2, DH / 2, 0, frameMat);
      addBox(group, DW + 0.1, 0.1, T + 0.08, 0, DH, 0, frameMat);

      if (!open) {
        const panel = new THREE.Mesh(
          new THREE.PlaneGeometry(DW - 0.05, DH - 0.05),
          new THREE.MeshStandardMaterial({
            color: sealed ? 0x2a0f0f : 0x1a1c20,
            emissive: sealed ? 0xe23b3b : 0x000000,
            emissiveIntensity: sealed ? 0.5 : 0,
            roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide,
          })
        );
        panel.position.set(0, DH / 2, 0.05);
        group.add(panel);
      } else {
        const beyond = new THREE.Mesh(new THREE.PlaneGeometry(DW - 0.05, DH - 0.05), voidMat);
        beyond.position.set(0, DH / 2, -0.16);
        group.add(beyond);
      }

      const future = propsRef.current.futures?.[propsRef.current.you?.room_code ?? ""]?.doors?.[dir]?.future;
      if (future) {
        const fh = FUTURE_HEX[future] ?? FUTURE_HEX.unknown;
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(DW, 0.09, 0.06),
          new THREE.MeshStandardMaterial({ color: fh, emissive: fh, emissiveIntensity: 1.4 })
        );
        strip.position.set(0, WH - 0.18, T / 2 + 0.02);
        strip.userData.led = true;
        group.add(strip);
      }

      const pick = new THREE.Mesh(
        new THREE.PlaneGeometry(DW, DH),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      pick.position.set(0, DH / 2, 0.08);
      pick.userData.dir = dir;
      pick.userData.door = true;
      group.add(pick);
      pickMeshes.push(pick);

      orientTo(group, dir);
      roomGroup.add(group);
    };

    const buildRoom = () => {
      const { you, arena, players, role, dice, exitUnsealed, firstPerson, youId } = propsRef.current;
      roomGroup.children.slice().forEach((c) => { roomGroup.remove(c); disposeGroup(c); });
      pickMeshes.length = 0;
      diceGems.length = 0;
      if (!you) return;

      const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      roomGroup.add(floor);

      const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), ceilMat);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.y = WH;
      roomGroup.add(ceiling);

      for (const dir of DIRS) buildWall(dir, you.doors?.[dir]);

      // Pedestal with four coloured d10 gems.
      const pedestalMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5, metalness: 0.5 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.42, 28), pedestalMat);
      base.position.y = 0.21;
      base.castShadow = true;
      base.receiveShadow = true;
      roomGroup.add(base);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 28), pedestalMat);
      top.position.y = 0.46;
      roomGroup.add(top);

      const rolls = dice?.[you.room_code ?? ""]?.doors ?? {};
      DIRS.forEach((dir, i) => {
        const d = rolls[dir];
        const color = (d?.color ?? DIRS[i]) as DoorColor;
        const hex = DOOR_HEX[color] ?? 0xe8b53a;
        const gem = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.14, 0),
          new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.4 })
        );
        const angle = (i / 4) * Math.PI * 2;
        gem.position.set(Math.cos(angle) * 0.28, 0.62, Math.sin(angle) * 0.28);
        gem.castShadow = true;
        roomGroup.add(gem);
        diceGems.push({ mesh: gem, base: 0.62, phase: i * 1.3 });
      });

      if (role === "timekeeper") {
        const parts = DIRS.map((dir) => {
          const d = rolls[dir];
          return d ? `${dir}${d.roll}` : `${dir}-`;
        });
        const label = makeLabel(parts.join("  "), "#e8b53a", 2.0);
        label.position.set(0, 1.45, 0);
        roomGroup.add(label);
      }

      const room = arena?.rooms.find((r) => r.code === you.room_code);
      if (room?.sigil && (role === "oracle" || role === "archivist")) {
        const glyph = makeLabel(SIGIL_GLYPH[room.sigil] ?? room.sigil, "#f4f1ea", 0.9);
        glyph.position.set(0, 1.1, 0);
        roomGroup.add(glyph);
      }

      // Exit beacon.
      const exitCode = arena ? `${String.fromCharCode(65 + arena.exit_room[0])}${arena.exit_room[1] + 1}` : "A5";
      if (you.room_code === exitCode) {
        const hex = exitUnsealed ? 0x3f9f6b : 0xe8b53a;
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.9, 1.15, 40),
          new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.02;
        ring.userData.beacon = true;
        roomGroup.add(ring);
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.7, 0.7, WH, 32, 1, true),
          new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: exitUnsealed ? 0.16 : 0.09, side: THREE.DoubleSide })
        );
        pillar.position.y = WH / 2;
        pillar.userData.beacon = true;
        roomGroup.add(pillar);
      }

      // Sanction floor.
      if (room && room.revealed && (room.sanction ?? 0) > 0) {
        const danger = new THREE.Mesh(
          new THREE.PlaneGeometry(H * 1.6, H * 1.6),
          new THREE.MeshBasicMaterial({ color: 0xe23b3b, transparent: true, opacity: 0.14 })
        );
        danger.rotation.x = -Math.PI / 2;
        danger.position.y = 0.015;
        danger.userData.sanction = true;
        roomGroup.add(danger);
      }

      // Teammates in this room.
      const mates = players.filter(
        (p) => p.room_code === you.room_code && !p.eliminated && (firstPerson ? p.id !== youId : true)
      );
      mates.forEach((p, i) => {
        const g = new THREE.Group();
        const color = new THREE.Color(p.color);
        const mat = new THREE.MeshStandardMaterial({
          color, emissive: color, emissiveIntensity: p.locked ? 0.9 : 0.25, roughness: 0.5, metalness: 0.2,
        });
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 6, 14), mat);
        body.position.y = 0.65;
        body.castShadow = true;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 18), mat);
        head.position.y = 1.15;
        const collar = new THREE.Mesh(
          new THREE.TorusGeometry(0.22, 0.035, 8, 24),
          new THREE.MeshStandardMaterial({
            color: p.locked ? 0xe23b3b : 0xf4f1ea,
            emissive: p.locked ? 0xe23b3b : 0x555049,
            emissiveIntensity: p.locked ? 1.4 : 0.25, metalness: 0.8, roughness: 0.3,
          })
        );
        collar.rotation.x = Math.PI / 2;
        collar.position.y = 0.95;
        g.add(body, head, collar);
        const angle = (i / Math.max(1, mates.length)) * Math.PI * 2 + 0.4;
        g.position.set(Math.cos(angle) * 1.35, 0, Math.sin(angle) * 1.35);
        const label = makeLabel(p.name || "?", p.locked ? "#e23b3b" : "#f4f1ea", 1.1);
        label.position.y = 1.6;
        g.add(label);
        roomGroup.add(g);
      });

      // Ceiling LED ring.
      const ringGeo = new THREE.TorusGeometry(1.5, 0.03, 8, 48);
      const ringMesh = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ color: 0xdfe6ff, transparent: true, opacity: 0.5 })
      );
      ringMesh.rotation.x = Math.PI / 2;
      ringMesh.position.y = WH - 0.05;
      ringMesh.userData.led = true;
      roomGroup.add(ringMesh);
    };

    apiRef.current = { rebuild: buildRoom, pulse: () => { glitch = 1; } };
    buildRoom();

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    // Pointer look + door picking.
    const yawRef = { current: 0 };
    const pitchRef = { current: 0 };
    const ndc = new THREE.Vector2(0, 0);
    const raycaster = new THREE.Raycaster();

    const viewDirection = (): Direction => {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      if (Math.abs(fwd.x) > Math.abs(fwd.z)) return fwd.x > 0 ? "E" : "W";
      return fwd.z > 0 ? "S" : "N";
    };

    const pick = () => {
      const locked = document.pointerLockElement === renderer.domElement;
      raycaster.setFromCamera(locked ? new THREE.Vector2(0, 0) : ndc, camera);
      const hits = raycaster.intersectObjects(pickMeshes, false);
      const dir = (hits[0]?.object.userData?.dir as Direction | undefined) ?? viewDirection();
      propsRef.current.onChooseDoor(dir);
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      if (document.pointerLockElement === renderer.domElement) {
        yawRef.current -= e.movementX * 0.0024;
        pitchRef.current = Math.max(-1.2, Math.min(1.2, pitchRef.current - e.movementY * 0.0024));
      }
    };
    const onPointerDown = () => {
      if (propsRef.current.firstPerson && document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock?.();
        return;
      }
      pick();
    };

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.1);
      const { firstPerson } = propsRef.current;
      if (firstPerson) {
        camera.position.set(0, 1.62, 0);
        camera.rotation.set(pitchRef.current, yawRef.current, 0, "YXZ");
      } else {
        camera.position.set(0, WH + 2.6, H + 3.4);
        camera.lookAt(0, 1.0, 0);
      }
      const t = performance.now();
      for (const gem of diceGems) {
        gem.mesh.position.y = gem.base + Math.sin(t / 600 + gem.phase) * 0.03;
        gem.mesh.rotation.y += dt * 0.8;
      }
      roomGroup.traverse((c) => {
        if (c.userData.beacon) {
          const mesh = c as THREE.Mesh;
          if (mesh.geometry instanceof THREE.RingGeometry) mesh.scale.setScalar(1 + Math.sin(t / 700) * 0.05);
        }
        if (c.userData.led) {
          const mesh = c as THREE.Mesh;
          const mat = mesh.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
          if ("emissiveIntensity" in mat) mat.emissiveIntensity = 1.1 + Math.sin(t / 500) * 0.35;
          else mat.opacity = 0.4 + Math.sin(t / 500) * 0.15;
        }
      });
      glitch = Math.max(0, glitch - dt * 1.8);
      wallMat.emissive.setHex(0xffffff);
      wallMat.emissiveIntensity = glitch * 0.35;
      glowLight.intensity = 8 + glitch * 30;
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    apiRef.current?.rebuild();
  }, [props.arena, props.you?.room_code, props.dice, props.futures, props.role, props.firstPerson, props.exitUnsealed, props.players]);

  useEffect(() => {
    if (props.transitionId > 0) apiRef.current?.pulse();
  }, [props.transitionId]);

  return <div ref={mountRef} className="absolute inset-0 cursor-crosshair" />;
}
