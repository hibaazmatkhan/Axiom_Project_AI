"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Arena, CrossEvent, Dice, Direction, Door, DoorColor, Player, Role, Visions, You } from "@/lib/types";

type Props = {
  arena: Arena | null;
  you: You | null;
  players: Player[];
  youId: string | null;
  role: Role | null;
  dice: Dice;
  futures: Visions;
  exitUnsealed: boolean;
  transitionId: number;
  moved: { from: [number, number]; to: [number, number]; code_from: string; code_to: string }[];
  cross: CrossEvent;
  firstPerson: boolean;
  onOpenDoor: (dir: Direction) => void;
  onCrossDoor: (dir: Direction) => void;
};

const H = 3;
const WH = 3.2;
const DW = 1.7;
const DH = 2.5;
const T = 0.22;
const FREE_SPEED = 2.6;
const DOOR_REACH = DW * 0.62;
const DOOR_BAND = 0.62;
const CROSS_COOLDOWN = 500;
const CROSS_LATCH_TIMEOUT = 1600;
const LOOK_SENSITIVITY = 0.0024;

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

function paintLabel(canvas: HTMLCanvasElement, text: string, color: string) {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(11,12,14,0.82)";
  ctx.fillRect(8, 14, 240, 68);
  ctx.strokeStyle = "rgba(244,241,234,0.22)";
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 14, 240, 68);
  ctx.font = "bold 42px ui-monospace, monospace";
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 50, 224);
}

function makeLabel(text: string, color = "#f4f1ea", scale = 1.5) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  paintLabel(canvas, text, color);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scale, scale * 0.375, 1);
  return sprite;
}

function makeDynamicLabel(text: string, color: string, scale: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  paintLabel(canvas, text, color);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }));
  sprite.scale.set(scale, scale * 0.375, 1);
  sprite.userData.setText = (next: string, nextColor: string) => {
    paintLabel(canvas, next, nextColor);
    tex.needsUpdate = true;
  };
  return sprite;
}

function makeCostLabel(cost: number) {
  const sprite = makeLabel(`-${cost}`, "#e8b53a", 0.74);
  sprite.position.set(0, DH + 0.46, 0.18);
  sprite.userData.cost = true;
  return sprite;
}

function orientTo(group: THREE.Object3D, dir: Direction) {
  if (dir === "N") { group.position.set(0, 0, -H); group.rotation.y = 0; }
  else if (dir === "S") { group.position.set(0, 0, H); group.rotation.y = Math.PI; }
  else if (dir === "E") { group.position.set(H, 0, 0); group.rotation.y = -Math.PI / 2; }
  else { group.position.set(-H, 0, 0); group.rotation.y = Math.PI / 2; }
}

const OPPOSITE: Record<Direction, Direction> = { N: "S", E: "W", S: "N", W: "E" };

function outwardVector(dir: Direction) {
  if (dir === "N") return { x: 0, z: -1 };
  if (dir === "S") return { x: 0, z: 1 };
  if (dir === "E") return { x: 1, z: 0 };
  return { x: -1, z: 0 };
}

function entryPose(dir: Direction) {
  if (dir === "N") return { x: 0, z: -H + 0.72, yaw: Math.PI };
  if (dir === "S") return { x: 0, z: H - 0.72, yaw: 0 };
  if (dir === "E") return { x: H - 0.72, z: 0, yaw: Math.PI / 2 };
  return { x: -H + 0.72, z: 0, yaw: -Math.PI / 2 };
}

function isEdgeDirection(room: [number, number] | null, size: number, dir: Direction) {
  if (!room) return false;
  const [bx, by] = room;
  if (dir === "N") return by <= 0;
  if (dir === "S") return by >= size - 1;
  if (dir === "E") return bx >= size - 1;
  return bx <= 0;
}

export default function GameCanvas(props: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const apiRef = useRef<{
    rebuild: () => void;
    pulse: () => void;
    entered: (event: CrossEvent) => void;
  } | null>(null);
  const lastCrossId = useRef(0);

  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(INK);
    scene.fog = new THREE.Fog(INK, 8, 28);

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
    const popups: { sprite: THREE.Sprite; born: number; baseY: number }[] = [];
    const flashes: { mesh: THREE.Mesh; born: number }[] = [];
    const doorSlides: {
      left: THREE.Mesh; right: THREE.Mesh; open: boolean; baseX: number; span: number;
    }[] = [];
    const doorTimers: {
      sprite: THREE.Sprite; openUntil: number; cost: number; lastText: string;
    }[] = [];
    let glitch = 0;
    let freePos = { x: 0, z: 0 };
    let yaw = 0;
    let pitch = 0;
    let orbitYaw = 0;
    let orbitPitch = 0.34;
    let orbitDist = 6.2;
    let dragging = false;
    let pointerLocked = false;
    let pointerLockRequested = false;
    let pointerDownAt = 0;
    let pointerStart = { x: 0, y: 0 };
    let pointerMoved = false;
    let crossLatch: Direction | null = null;
    let crossLatchAt = 0;
    let lastCrossSent = 0;
    const keys: Record<string, boolean> = {};

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

    const buildWall = (
      parent: THREE.Object3D,
      dir: Direction, door: Door & { open?: boolean } | undefined,
      roomCode: string, interactive: boolean, edge: boolean,
    ) => {
      const group = new THREE.Group();
      if (edge) {
        addBox(group, H * 2, WH, T, 0, WH / 2, 0, wallMat);
        orientTo(group, dir);
        parent.add(group);
        return;
      }
      const side = H - DW / 2;
      const sideC = (H + DW / 2) / 2;
      addBox(group, side, WH, T, -sideC, WH / 2, 0, wallMat);
      addBox(group, side, WH, T, sideC, WH / 2, 0, wallMat);
      addBox(group, DW, WH - DH, T, 0, (DH + WH) / 2, 0, wallMat);

      const color: DoorColor = door?.color ?? "red";
      const sealed = !!door?.sealed;
      const tempOpen = !!door?.temporary_open && (door?.open_until ?? 0) > Date.now() / 1000;
      const structuralOpen = !!door?.open && !sealed && !tempOpen;
      const passable = structuralOpen || tempOpen;
      const hex = tempOpen ? 0xe8b53a : sealed ? 0xe23b3b : DOOR_HEX[color] ?? 0xe23b3b;

      const frameMat = new THREE.MeshStandardMaterial({
        color: hex, emissive: hex, emissiveIntensity: tempOpen ? 2.1 : sealed ? 1.5 : 0.85,
        roughness: 0.35, metalness: 0.45,
      });
      addBox(group, 0.1, DH, T + 0.08, -DW / 2, DH / 2, 0, frameMat);
      addBox(group, 0.1, DH, T + 0.08, DW / 2, DH / 2, 0, frameMat);
      addBox(group, DW + 0.1, 0.1, T + 0.08, 0, DH, 0, frameMat);

      if (!structuralOpen) {
        const panelMat = new THREE.MeshStandardMaterial({
          color: tempOpen ? 0x3a3220 : sealed ? 0x2a0f0f : 0x1a1c20,
          emissive: tempOpen ? 0xe8b53a : sealed ? 0xe23b3b : 0x000000,
          emissiveIntensity: tempOpen ? 0.35 : sealed ? 0.5 : 0,
          roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide,
        });
        const halfW = (DW - 0.08) / 2;
        const left = addBox(group, halfW, DH - 0.05, 0.06, -halfW / 2, DH / 2, 0.06, panelMat);
        const right = addBox(group, halfW, DH - 0.05, 0.06, halfW / 2, DH / 2, 0.06, panelMat);
        doorSlides.push({ left, right, open: tempOpen, baseX: halfW / 2, span: halfW });
      }
      if (passable) {
        const beyond = new THREE.Mesh(new THREE.PlaneGeometry(DW - 0.05, DH - 0.05),
          tempOpen
            ? new THREE.MeshBasicMaterial({
              color: 0xe8b53a, transparent: true, opacity: 0.14,
              side: THREE.DoubleSide, depthWrite: false,
            })
            : voidMat);
        beyond.position.set(0, DH / 2, -0.16);
        group.add(beyond);
      }
      if (tempOpen && door?.open_until) {
        const timer = makeDynamicLabel(`${Math.ceil(door.open_until - Date.now() / 1000)}s · -1`, "#3f9f6b", 0.94);
        timer.position.set(0, DH + 0.88, 0.2);
        group.add(timer);
        doorTimers.push({ sprite: timer, openUntil: door.open_until, cost: 1, lastText: "" });
      }

      const future = propsRef.current.futures?.[roomCode]?.doors?.[dir]?.future;
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

      group.add(makeCostLabel(1));

      if (interactive) {
        const pick = new THREE.Mesh(
          new THREE.PlaneGeometry(DW, DH),
          new THREE.MeshBasicMaterial({ visible: false })
        );
        pick.position.set(0, DH / 2, 0.08);
        pick.userData.dir = dir;
        pick.userData.door = true;
        group.add(pick);
        pickMeshes.push(pick);
      }

      orientTo(group, dir);
      parent.add(group);
    };

    const buildRoomInto = (
      parent: THREE.Group, roomYou: You, offsetX: number, offsetZ: number, interactive: boolean,
    ) => {
      parent.children.slice().forEach((c) => { parent.remove(c); disposeGroup(c); });
      parent.position.set(offsetX, 0, offsetZ);
      const { arena, players, role, dice, exitUnsealed, youId } = propsRef.current;
      if (!roomYou) return;
      const gemSink = interactive ? diceGems : [];

      const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      parent.add(floor);

      const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), ceilMat);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.y = WH;
      parent.add(ceiling);

      const arenaSize = arena?.size ?? 5;
      for (const dir of DIRS) {
        buildWall(
          parent, dir, roomYou.doors?.[dir], roomYou.room_code ?? "", interactive,
          isEdgeDirection(roomYou.room, arenaSize, dir),
        );
      }

      const pedestalMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5, metalness: 0.5 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.42, 28), pedestalMat);
      base.position.y = 0.21;
      base.castShadow = true;
      base.receiveShadow = true;
      parent.add(base);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 28), pedestalMat);
      top.position.y = 0.46;
      parent.add(top);

      const rolls = dice?.[roomYou.room_code ?? ""]?.doors ?? {};
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
        parent.add(gem);
        gemSink.push({ mesh: gem, base: 0.62, phase: i * 1.3 });
      });

      if (role === "timekeeper") {
        const parts = DIRS.map((dir) => {
          const d = rolls[dir];
          return d ? `${dir}${d.roll}` : `${dir}-`;
        });
        const label = makeLabel(parts.join("  "), "#e8b53a", 2.0);
        label.position.set(0, 1.45, 0);
        parent.add(label);
      }

      const room = arena?.rooms.find((r) => r.code === roomYou.room_code);
      if (room?.sigil && (role === "oracle" || role === "archivist")) {
        const glyph = makeLabel(SIGIL_GLYPH[room.sigil] ?? room.sigil, "#f4f1ea", 0.9);
        glyph.position.set(0, 1.1, 0);
        parent.add(glyph);
      }

      const exitCode = arena ? `${String.fromCharCode(65 + arena.exit_room[0])}${arena.exit_room[1] + 1}` : "A5";
      if (roomYou.room_code === exitCode) {
        const hex = exitUnsealed ? 0x3f9f6b : 0xe8b53a;
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.9, 1.15, 40),
          new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.02;
        ring.userData.beacon = true;
        parent.add(ring);
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.7, 0.7, WH, 32, 1, true),
          new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: exitUnsealed ? 0.16 : 0.09, side: THREE.DoubleSide })
        );
        pillar.position.y = WH / 2;
        pillar.userData.beacon = true;
        parent.add(pillar);
      }

      if (room && room.revealed && (room.sanction ?? 0) > 0) {
        const danger = new THREE.Mesh(
          new THREE.PlaneGeometry(H * 1.6, H * 1.6),
          new THREE.MeshBasicMaterial({ color: 0xe23b3b, transparent: true, opacity: 0.14 })
        );
        danger.rotation.x = -Math.PI / 2;
        danger.position.y = 0.015;
        danger.userData.sanction = true;
        parent.add(danger);
      }

      const hideSelf = propsRef.current.firstPerson;
      const mates = players.filter(
        (p) => p.room_code === roomYou.room_code && !p.eliminated && (hideSelf ? p.id !== youId : true)
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
        parent.add(g);
      });

      const ringGeo = new THREE.TorusGeometry(1.5, 0.03, 8, 48);
      const ringMesh = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ color: 0xdfe6ff, transparent: true, opacity: 0.5 })
      );
      ringMesh.rotation.x = Math.PI / 2;
      ringMesh.position.y = WH - 0.05;
      ringMesh.userData.led = true;
      parent.add(ringMesh);
    };

    const rebuild = () => {
      const you = propsRef.current.you;
      if (!you) return;
      pickMeshes.length = 0;
      diceGems.length = 0;
      doorSlides.length = 0;
      doorTimers.length = 0;
      popups.length = 0;
      flashes.length = 0;
      buildRoomInto(roomGroup, you, 0, 0, true);
    };

    const entered = (event: CrossEvent) => {
      const door = event.door ?? "N";
      const pose = entryPose(OPPOSITE[door]);
      freePos = { x: pose.x, z: pose.z };
      yaw = pose.yaw;
      pitch = 0;
      crossLatch = null;
      crossLatchAt = 0;
      lastCrossSent = 0;
      glitch = Math.max(glitch, 0.45);
    };

    apiRef.current = { rebuild, pulse: () => { glitch = 1; }, entered };
    rebuild();

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

    const ndc = new THREE.Vector2(0, 0);
    const raycaster = new THREE.Raycaster();

    const centerNdc = new THREE.Vector2(0, 0);
    const viewDirection = (): Direction => {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      if (Math.abs(fwd.x) > Math.abs(fwd.z)) return fwd.x > 0 ? "E" : "W";
      return fwd.z > 0 ? "S" : "N";
    };

    const intersectDir = (pointer: THREE.Vector2) => {
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(pickMeshes, false)
        .map((hit) => hit.object.userData?.dir as Direction | undefined)
        .find((dir): dir is Direction => !!dir);
    };

    const openDoor = (dir: Direction) => {
      const door = propsRef.current.you?.doors?.[dir];
      if (door?.temporary_open && (door.open_until ?? 0) > Date.now() / 1000) return;
      propsRef.current.onOpenDoor(dir);
    };

    const pick = (pointer?: THREE.Vector2) => {
      const dir = intersectDir(pointer ?? (pointerLocked ? centerNdc : ndc));
      if (dir) openDoor(dir);
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      if (dragging && !pointerLocked) {
        if (Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 6) pointerMoved = true;
      }
      if (pointerLocked && propsRef.current.firstPerson) {
        yaw -= e.movementX * LOOK_SENSITIVITY;
        pitch = Math.max(-1.2, Math.min(1.2, pitch - e.movementY * LOOK_SENSITIVITY));
      } else if (dragging && propsRef.current.firstPerson) {
        yaw -= e.movementX * LOOK_SENSITIVITY * 1.5;
        pitch = Math.max(-1.2, Math.min(1.2, pitch - e.movementY * LOOK_SENSITIVITY * 1.5));
      } else if (dragging) {
        orbitYaw -= e.movementX * 0.005;
        orbitPitch = Math.max(0.08, Math.min(1.12, orbitPitch - e.movementY * 0.004));
      }
    };

    const canLockPointer =
      typeof renderer.domElement.requestPointerLock === "function" &&
      window.matchMedia("(pointer: fine)").matches;

    const onPointerDown = (e: PointerEvent) => {
      pointerDownAt = performance.now();
      pointerStart = { x: e.clientX, y: e.clientY };
      pointerMoved = false;
      if (!propsRef.current.firstPerson) {
        dragging = true;
        return;
      }
      if (canLockPointer && !pointerLocked) {
        const hit = intersectDir(ndc);
        if (hit) openDoor(hit);
        pointerLockRequested = true;
        dragging = true;
        try {
          const result = renderer.domElement.requestPointerLock();
          if (result instanceof Promise) result.catch(() => { pointerLockRequested = false; });
        } catch {
          pointerLockRequested = false;
        }
        return;
      }
      dragging = !pointerLocked;
      pick(pointerLocked ? centerNdc : ndc);
    };

    const onPointerUp = () => {
      if (pointerLockRequested) {
        pointerLockRequested = false;
        dragging = false;
        return;
      }
      if (dragging && !pointerLocked && propsRef.current.firstPerson &&
          !pointerMoved && performance.now() - pointerDownAt < 350) {
        pick(ndc);
      }
      dragging = false;
    };

    const onPointerLockChange = () => {
      pointerLocked = document.pointerLockElement === renderer.domElement;
      if (!pointerLocked) {
        dragging = false;
        pointerLockRequested = false;
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (propsRef.current.firstPerson) return;
      e.preventDefault();
      orbitDist = Math.max(3.2, Math.min(11, orbitDist + Math.sign(e.deltaY) * 0.6));
    };

    const movementKeys = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(target?.tagName ?? "")) return;
      const k = e.key.toLowerCase();
      if (k === "e" || k === "enter") {
        e.preventDefault();
        openDoor(viewDirection());
        return;
      }
      if (movementKeys.has(k)) {
        e.preventDefault();
        keys[k] = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (movementKeys.has(k)) keys[k] = false;
    };

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const nearOpenDoor = (pos: { x: number; z: number }, you: You | null, nowMs: number) => {
      if (!you) return null;
      for (const dir of DIRS) {
        const door = you.doors?.[dir];
        if (!door?.temporary_open || (door.open_until ?? 0) * 1000 <= nowMs) continue;
        const v = outwardVector(dir);
        const along = pos.x * v.x + pos.z * v.z;
        const across = Math.abs(pos.x * v.z - pos.z * v.x);
        if (along >= H - DOOR_REACH && across <= DOOR_BAND) return dir;
      }
      return null;
    };

    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.1);
      const t = performance.now();
      const { firstPerson } = propsRef.current;

      if (firstPerson) {
        let localX = 0;
        let localZ = 0;
        if (keys.w || keys.arrowup) localZ -= 1;
        if (keys.s || keys.arrowdown) localZ += 1;
        if (keys.a || keys.arrowleft) localX -= 1;
        if (keys.d || keys.arrowright) localX += 1;
        const moving = localX !== 0 || localZ !== 0;
        if (moving) {
          const length = Math.hypot(localX, localZ) || 1;
          localX /= length;
          localZ /= length;
          const sin = Math.sin(yaw);
          const cos = Math.cos(yaw);
          freePos.x += (localX * cos + localZ * sin) * FREE_SPEED * dt;
          freePos.z += (-localX * sin + localZ * cos) * FREE_SPEED * dt;
          const bound = H - 0.55;
          freePos.x = Math.max(-bound, Math.min(bound, freePos.x));
          freePos.z = Math.max(-bound, Math.min(bound, freePos.z));
        }
        if (crossLatch && t - crossLatchAt > CROSS_LATCH_TIMEOUT) crossLatch = null;
        const nearDoor = nearOpenDoor(freePos, propsRef.current.you, t);
        if (nearDoor !== crossLatch) {
          crossLatch = nearDoor;
          if (nearDoor) {
            crossLatchAt = t;
            if (t - lastCrossSent >= CROSS_COOLDOWN) {
              lastCrossSent = t;
              propsRef.current.onCrossDoor(nearDoor);
            }
          }
        }
        const bob = moving ? Math.sin(t / 105) * 0.022 : Math.sin(t / 900) * 0.004;
        camera.position.set(freePos.x, 1.62 + bob, freePos.z);
        camera.rotation.set(pitch, yaw, 0, "YXZ");
      } else {
        const target = new THREE.Vector3(freePos.x, 0.95, freePos.z);
        const horizontal = Math.cos(orbitPitch) * orbitDist;
        camera.position.set(
          target.x + Math.sin(orbitYaw) * horizontal,
          target.y + Math.sin(orbitPitch) * orbitDist,
          target.z + Math.cos(orbitYaw) * horizontal,
        );
        camera.lookAt(target);
      }

      for (const gem of diceGems) {
        gem.mesh.position.y = gem.base + Math.sin(t / 600 + gem.phase) * 0.03;
        gem.mesh.rotation.y += dt * 0.8;
      }

      const slideEase = Math.min(1, dt * 7);
      for (const slide of doorSlides) {
        const target = slide.baseX + (slide.open ? slide.span * 0.95 : 0);
        const leftTarget = -target;
        slide.left.position.x += (leftTarget - slide.left.position.x) * slideEase;
        slide.right.position.x += (target - slide.right.position.x) * slideEase;
      }

      const nowSeconds = Date.now() / 1000;
      for (const timer of doorTimers) {
        const remaining = Math.max(0, timer.openUntil - nowSeconds);
        const text = `${remaining.toFixed(1)}s · -${timer.cost}`;
        if (text !== timer.lastText) {
          timer.lastText = text;
          (timer.sprite.userData.setText as (value: string, color: string) => void)?.(
            text, remaining <= 3 ? "#e23b3b" : "#3f9f6b",
          );
        }
        timer.sprite.visible = remaining > 0;
      }

      scene.traverse((c) => {
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
        if (c.userData.cost) {
          const sprite = c as THREE.Sprite;
          const pulse = 0.74 * (1 + Math.sin(t / 420) * 0.07);
          sprite.scale.set(pulse, pulse * 0.375, 1);
        }
      });

      for (let i = popups.length - 1; i >= 0; i -= 1) {
        const popup = popups[i];
        const age = (t - popup.born) / 1100;
        if (age >= 1) {
          roomGroup.remove(popup.sprite);
          popup.sprite.material.map?.dispose();
          popup.sprite.material.dispose();
          popups.splice(i, 1);
          continue;
        }
        popup.sprite.position.y = popup.baseY + age * 0.9;
        const scale = 1.05 + Math.sin(age * Math.PI) * 0.3;
        popup.sprite.scale.set(scale, scale * 0.375, 1);
        popup.sprite.material.opacity = 1 - age;
      }

      for (let i = flashes.length - 1; i >= 0; i -= 1) {
        const flash = flashes[i];
        const age = (t - flash.born) / 620;
        if (age >= 1) {
          roomGroup.remove(flash.mesh);
          flash.mesh.geometry.dispose();
          (flash.mesh.material as THREE.Material).dispose();
          flashes.splice(i, 1);
          continue;
        }
        flash.mesh.scale.setScalar(1 + age * 0.9);
        (flash.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - age);
      }

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
      renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!props.firstPerson && typeof document !== "undefined" && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [props.firstPerson]);

  useEffect(() => {
    apiRef.current?.rebuild();
  }, [props.arena, props.you?.doors, props.you?.room_code, props.you?.room?.[0], props.you?.room?.[1], props.dice, props.futures, props.role, props.firstPerson, props.exitUnsealed, props.players]);

  useEffect(() => {
    if (props.transitionId > 0) apiRef.current?.pulse();
  }, [props.transitionId]);

  useEffect(() => {
    if (props.cross.id > 0 && props.cross.id !== lastCrossId.current) {
      lastCrossId.current = props.cross.id;
      if (!props.cross.player || props.cross.player === props.you?.id) apiRef.current?.entered(props.cross);
    }
  }, [props.cross, props.you?.id]);

  return <div ref={mountRef} className="absolute inset-0 cursor-crosshair" />;
}
