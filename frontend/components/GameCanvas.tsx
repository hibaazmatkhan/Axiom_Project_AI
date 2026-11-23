"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { playSound, unlockAudio } from "@/lib/audio";
import type { Arena, CrossEvent, Direction, Door, DoorColor, KingEvent, KingView, Player, Pose, You } from "@/lib/types";

type DoorEventView = {
  id: number;
  type: "door_result" | "door_opened" | "door_closed" | "lockdown";
  accepted: boolean;
  locked?: boolean;
  sealed?: boolean;
  code?: string;
  player?: string;
  door?: string;
  room_code?: string;
  target_code?: string;
  message?: string;
};

type Props = {
  arena: Arena | null;
  you: You | null;
  players: Player[];
  youId: string | null;
  transitionId: number;
  moved: ShiftMove[];
  cross: CrossEvent;
  doorEvent: DoorEventView | null;
  king: KingView | null;
  kingEvent: KingEvent | null;
  elimination: { id: number; player: string; reason: string } | null;
  ghost: boolean;
  poses: Record<string, Pose>;
  exitWall: Direction[];
  onOpenDoor: (dir: Direction) => void;
  onCrossDoor: (dir: Direction) => void;
  onPose: (pose: Pose) => void;
};

type ShiftMove = {
  from: [number, number];
  to: [number, number];
  code_from: string;
  code_to: string;
};

type CrossAnimation = {
  startedAt: number | null;
  receivedAt: number;
  dir: Direction;
  from: string | null;
  to: string | null;
  current: THREE.Vector3;
  start: THREE.Vector3;
  gate: THREE.Vector3;
  end: THREE.Vector3;
  velocity: THREE.Vector3;
  yawFrom: number;
  yawTo: number;
};

type BloodParticle = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  born: number;
  life: number;
};

type BloodPool = {
  mesh: THREE.Mesh;
  born: number;
  life: number;
};

type ShiftMarker = {
  mesh: THREE.Mesh;
  born: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  duration: number;
};

const H = 3;
const WH = 3.2;
const DW = 1.7;
const DH = 2.5;
const T = 0.22;
const ROOM_STEP = H * 2;
const FREE_SPEED = 2.6;
const WALK_ACCEL = 12;
const WALK_DRAG = 9;
const LEAN_SMOOTH = 7;
const DOOR_REACH = DW * 0.62;
const DOOR_BAND = 0.62;
const CROSS_COOLDOWN = 500;
const CROSS_STATE_TIMEOUT = 1400;
const CROSS_SPEED = 3.1;
const CROSS_ACCEL = 7;
const CROSS_FINISH_DISTANCE = 0.2;
const CROSS_TIMEOUT = 2400;
const LOOK_SENSITIVITY = 0.0024;

const INK = 0x0b0c0e;
const WHITE = 0xf4f1ea;
const LOCK_WALL = 0x9b1119;
const LOCK_FLOOR = 0x760b11;
const LOCK_CEIL = 0x870d14;
const LOCK_LIGHT = 0xff2b35;
const LOCK_FOG = 0x240204;
const DOOR_HEX: Record<DoorColor, number> = {
  red: 0xe23b3b, blue: 0x3f7bd9, yellow: 0xe8b53a, green: 0x3f9f6b,
};
const DIRS: Direction[] = ["N", "E", "S", "W"];

function doorSignature(doors?: You["doors"]) {
  if (!doors) return "";
  return DIRS.map((dir) => {
    const door = doors[dir];
    return `${door?.color}:${door?.open}:${door?.temporary_open}:${door?.open_until}`;
  }).join("|");
}

function arenaSignature(arena: Arena | null) {
  if (!arena) return "";
  return `${arena.size}:${arena.rooms.map((room) => {
    const doors = DIRS.map((dir) => {
      const door = room.doors[dir];
      return `${door?.color}`;
    }).join("|");
    const open = DIRS.map((dir) => (room.open[dir] ? "1" : "0")).join("");
    return `${room.code}:${room.bx}:${room.by}:${room.sigil}:${room.sanction}:${room.revealed}:${doors}:${open}`;
  }).join("|")}`;
}

function playerSignature(players: Player[]) {
  return players.map((p) => `${p.id}:${p.name}:${p.slot}:${p.color}:${p.avatar_url}:${p.role}:${p.room_code}:${p.locked}:${p.eliminated}:${p.escaped}:${p.ready}:${p.connected}`).join("|");
}

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

function paintWallText(canvas: HTMLCanvasElement, text: string, color: string) {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "bold 74px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 24);
  ctx.shadowBlur = 0;
}

function makeWallText(text: string, color: string, width = 0.92) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  paintWallText(canvas, text, color);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * 160 / 512),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.userData.setText = (next: string, nextColor: string) => {
    paintWallText(canvas, next, nextColor);
    texture.needsUpdate = true;
  };
  return mesh;
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

function roomYouFrom(base: You, room: Arena["rooms"][number]): You {
  return {
    ...base,
    room_id: room.id,
    room_code: room.code,
    room: [room.bx, room.by],
    doors: room.doors as You["doors"],
    locked: false,
    eliminated: false,
    escaped: false,
  };
}

function yawFor(dir: Direction) {
  if (dir === "N") return 0;
  if (dir === "E") return -Math.PI / 2;
  if (dir === "S") return Math.PI;
  return Math.PI / 2;
}

function shortestAngle(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
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
  const [pointerLocked, setPointerLocked] = useState(false);
  const propsRef = useRef(props);
  propsRef.current = props;
  const apiRef = useRef<{
    rebuild: () => void;
    pulse: (moved: ShiftMove[]) => void;
    entered: (event: CrossEvent) => void;
    doorEvent: (event: DoorEventView) => void;
    kingEvent: (event: KingEvent) => void;
    elimination: (event: { player: string; reason: string }) => void;
  } | null>(null);
  const lastCrossId = useRef(0);
  const lastDoorEventId = useRef(0);
  const lastKingEventId = useRef(0);
  const lastEliminationId = useRef(0);
  const lastShiftPulseId = useRef(0);
  const arenaSig = arenaSignature(props.arena);
  const doorSig = doorSignature(props.you?.doors);
  const playerSig = playerSignature(props.players);
  const kingSig = props.king
    ? `${props.king.id}:${props.king.room_code}:${props.king.teleport_index}:${props.king.kill_count}`
    : "";

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
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "grab";
    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x1a1c20, 1.05);
    scene.add(hemi);
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
    const shiftGroup = new THREE.Group();
    scene.add(shiftGroup);

    const pickMeshes: THREE.Mesh[] = [];
    const popups: { sprite: THREE.Sprite; born: number; baseY: number }[] = [];
    const flashes: { mesh: THREE.Mesh; born: number }[] = [];
    const shiftMarkers: ShiftMarker[] = [];
    const avatarLoader = new THREE.TextureLoader();
    const avatarTextures = new Map<string, THREE.Texture>();
    const avatarTexture = (url: string) => {
      const cached = avatarTextures.get(url);
      if (cached) return cached;
      const texture = avatarLoader.load(url);
      avatarTextures.set(url, texture);
      return texture;
    };
    const doorSlides: {
      dir: Direction; left: THREE.Mesh; right: THREE.Mesh; open: boolean; baseX: number; span: number;
      leftPos: number; rightPos: number;
    }[] = [];
    const doorTimers: {
      label: THREE.Mesh; openUntil: number; cost: number; lastText: string;
    }[] = [];
    let glitch = 0;
    let lockMix = 0;
    const tintScratch = new THREE.Color();
    const mixColor = (out: THREE.Color, from: number, to: number, mix: number) => {
      out.setHex(from).lerp(tintScratch.setHex(to), mix);
    };
    let freePos = { x: 0, z: 0 };
    let freeVel = { x: 0, z: 0 };
    let lean = 0;
    let bobPhase = 0;
    let yaw = 0;
    let pitch = 0;
    let dragging = false;
    let pointerInside = false;
    let activePointerId: number | null = null;
    let pointerDownAt = 0;
    let pointerDown = { x: 0, y: 0 };
    let pointerLast = { x: 0, y: 0 };
    let pointerMoved = false;
    let crossLatch: Direction | null = null;
    let crossLatchAt = 0;
    let lastCrossSent = 0;
    let lastStepAt = 0;
    const previewGroups = new Map<Direction, THREE.Group>();
    let crossAnim: CrossAnimation | null = null;
    let kingGroup: THREE.Group | null = null;
    let kingEyes: THREE.Mesh[] = [];
    let kingLight: THREE.PointLight | null = null;
    const blood: BloodParticle[] = [];
    const bloodPools: BloodPool[] = [];
    let bloodRoomCode: string | null = null;
    const keys: Record<string, boolean> = {};

    const wallMat = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.92, metalness: 0.02 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xe7e3da, roughness: 0.95 });
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0xdfdbd2, roughness: 1.0 });
    for (const m of [wallMat, floorMat, ceilMat]) m.userData.shared = true;

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
      interactive: boolean, edge: boolean, exitDoor = false,
    ) => {
      const group = new THREE.Group();
      if (edge) {
        if (exitDoor) {
          const side = H - DW / 2;
          const sideC = (H + DW / 2) / 2;
          addBox(group, side, WH, T, -sideC, WH / 2, 0, wallMat);
          addBox(group, side, WH, T, sideC, WH / 2, 0, wallMat);
          addBox(group, DW, WH - DH, T, 0, (DH + WH) / 2, 0, wallMat);
          const frameMat = new THREE.MeshStandardMaterial({
            color: 0xf6f1e4, emissive: 0xfff4d8, emissiveIntensity: 0.45,
            roughness: 0.3, metalness: 0.2,
          });
          addBox(group, 0.12, DH, T + 0.12, -DW / 2, DH / 2, 0.05, frameMat);
          addBox(group, 0.12, DH, T + 0.12, DW / 2, DH / 2, 0.05, frameMat);
          addBox(group, DW + 0.12, 0.12, T + 0.12, 0, DH, 0.05, frameMat);
          const voidPanel = new THREE.Mesh(
            new THREE.PlaneGeometry(DW, DH),
            new THREE.MeshBasicMaterial({
              color: 0x000000, side: THREE.DoubleSide, depthWrite: false,
            }),
          );
          voidPanel.position.set(0, DH / 2, -T / 2 - 0.02);
          voidPanel.userData.exitDoor = true;
          group.add(voidPanel);
          const spill = new THREE.Mesh(
            new THREE.PlaneGeometry(DW * 1.3, DH * 1.15),
            new THREE.MeshBasicMaterial({
              color: 0xfff4d8, transparent: true, opacity: 0.12,
              side: THREE.DoubleSide, depthWrite: false,
            }),
          );
          spill.position.set(0, DH / 2, T / 2 + 0.03);
          group.add(spill);
        } else {
          addBox(group, H * 2, WH, T, 0, WH / 2, 0, wallMat);
        }
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
      const tempOpen = !!door?.temporary_open && (door?.open_until ?? 0) > Date.now() / 1000;
      const hex = DOOR_HEX[color] ?? 0xe23b3b;

      const frameMat = new THREE.MeshStandardMaterial({
        color: hex, emissive: hex, emissiveIntensity: tempOpen ? 1.5 : 0.95,
        roughness: 0.35, metalness: 0.45,
      });
      addBox(group, 0.1, DH, T + 0.08, -DW / 2, DH / 2, 0, frameMat);
      addBox(group, 0.1, DH, T + 0.08, DW / 2, DH / 2, 0, frameMat);
      addBox(group, DW + 0.1, 0.1, T + 0.08, 0, DH, 0, frameMat);

      const panelMat = new THREE.MeshStandardMaterial({
        color: hex, emissive: hex, emissiveIntensity: tempOpen ? 1.05 : 0.85,
        roughness: 0.45, metalness: 0.25, side: THREE.DoubleSide,
      });
      const lightMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(hex).lerp(new THREE.Color(0xffffff), 0.35),
        emissive: hex, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.2,
      });
      const halfW = (DW - 0.08) / 2;
      const left = addBox(group, halfW, DH - 0.05, 0.06, -halfW / 2, DH / 2, 0.06, panelMat);
      const right = addBox(group, halfW, DH - 0.05, 0.06, halfW / 2, DH / 2, 0.06, panelMat);
      [left, right].forEach((panel, i) => {
        addBox(
          panel, 0.07, 0.5, 0.03,
          i === 0 ? halfW / 2 - 0.1 : -halfW / 2 + 0.1, 0, 0.05, lightMat,
        );
      });
      if (interactive) {
        doorSlides.push({
          dir, left, right, open: tempOpen,
          baseX: halfW / 2, span: halfW,
          leftPos: -halfW / 2, rightPos: halfW / 2,
        });
      }
      if (tempOpen && door?.open_until && interactive) {
        const timer = makeWallText(
          `${Math.max(0, door.open_until - Date.now() / 1000).toFixed(1)}s`,
          "#3f9f6b", 0.78,
        );
        timer.position.set(0, DH + 0.9, T / 2 + 0.02);
        group.add(timer);
        doorTimers.push({ label: timer, openUntil: door.open_until, cost: 1, lastText: "" });
      }

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

    const buildKing = (parent: THREE.Group) => {
      kingGroup = new THREE.Group();
      const cloakMat = new THREE.MeshStandardMaterial({
        color: 0x050405, emissive: 0x140005, emissiveIntensity: 0.6,
        roughness: 0.82, metalness: 0.18,
      });
      const boneMat = new THREE.MeshStandardMaterial({
        color: 0xb9b1a4, emissive: 0x2c0002, emissiveIntensity: 0.25,
        roughness: 0.9,
      });
      const eyeMat = new THREE.MeshStandardMaterial({
        color: 0xff0018, emissive: 0xff0018, emissiveIntensity: 3.2,
        roughness: 0.2,
      });
      const robe = new THREE.Mesh(new THREE.ConeGeometry(0.52, 1.5, 10), cloakMat);
      robe.position.y = 0.75;
      robe.castShadow = true;
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.42, 6, 12), cloakMat);
      torso.position.y = 1.02;
      torso.castShadow = true;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), boneMat);
      head.position.y = 1.42;
      head.castShadow = true;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.58, 8), cloakMat);
      crown.position.y = 1.78;
      crown.castShadow = true;
      const eyeLeft = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 10), eyeMat);
      eyeLeft.position.set(-0.09, 1.46, 0.19);
      const eyeRight = eyeLeft.clone();
      eyeRight.position.x = 0.09;
      kingEyes = [eyeLeft, eyeRight];
      const claws = new THREE.Group();
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.7, 6), boneMat);
        arm.position.set(side * 0.3, 1.0, 0.08);
        arm.rotation.z = side * 0.28;
        claws.add(arm);
      }
      const mark = makeLabel("\u2660", "#ff1f2d", 0.7);
      mark.position.set(0, 1.28, 0.24);
      kingGroup.add(robe, torso, head, crown, eyeLeft, eyeRight, claws, mark);
      kingLight = new THREE.PointLight(0xff0018, 12, 5, 2);
      kingLight.position.set(0, 1.5, 0.35);
      kingGroup.add(kingLight);
      kingGroup.position.set(0, 0, -2.15);
      kingGroup.userData.king = true;
      parent.add(kingGroup);
    };

    const clearBlood = () => {
      for (const particle of blood) {
        scene.remove(particle.mesh);
        particle.mesh.geometry.dispose();
        (particle.mesh.material as THREE.Material).dispose();
      }
      blood.length = 0;
      for (const pool of bloodPools) {
        scene.remove(pool.mesh);
        pool.mesh.geometry.dispose();
        (pool.mesh.material as THREE.Material).dispose();
      }
      bloodPools.length = 0;
    };

    const spawnBlood = (roomCode: string | null) => {
      const currentRoom = propsRef.current.you?.room_code ?? null;
      if (roomCode && roomCode !== currentRoom) return;
      bloodRoomCode = currentRoom;
      const origin = new THREE.Vector3(0, 1.25, -1.6);
      const born = performance.now();
      for (let i = 0; i < 78; i += 1) {
        const material = new THREE.MeshStandardMaterial({
          color: i % 4 === 0 ? 0x560006 : i % 3 === 0 ? 0x8b0008 : 0xd20417,
          emissive: 0x6d0007,
          emissiveIntensity: 0.85,
          transparent: true,
          opacity: 0.96,
          roughness: 0.32,
        });
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.016 + Math.random() * 0.06, 6, 6), material,
        );
        mesh.position.copy(origin);
        mesh.position.x += (Math.random() - 0.5) * 0.5;
        mesh.position.z += (Math.random() - 0.5) * 0.5;
        scene.add(mesh);
        blood.push({
          mesh,
          velocity: new THREE.Vector3(
            (Math.random() - 0.5) * 4.8,
            0.8 + Math.random() * 4.2,
            (Math.random() - 0.5) * 4.8,
          ),
          born,
          life: 900 + Math.random() * 1500,
        });
      }
      for (let i = 0; i < 7; i += 1) {
        const radius = 0.35 + Math.random() * 0.9;
        const material = new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? 0x5d0008 : 0x8b0008,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const pool = new THREE.Mesh(new THREE.CircleGeometry(radius, 22), material);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(
          (Math.random() - 0.5) * 2.2,
          0.018 + i * 0.0008,
          -1.6 + (Math.random() - 0.5) * 2.2,
        );
        pool.scale.y = 0.55 + Math.random() * 0.5;
        scene.add(pool);
        bloodPools.push({ mesh: pool, born, life: 4200 + Math.random() * 2400 });
      }
      glitch = 1;
    };

    const kingEvent = (event: KingEvent) => {
      const currentRoom = propsRef.current.you?.room_code ?? null;
      const here = !event.room_code || event.room_code === currentRoom;
      if (event.type === "kill") {
        glitch = 1;
        spawnBlood(event.room_code ?? currentRoom);
        return;
      }
      if (here && (event.type === "spawn" || event.type === "teleport")) playSound("warning");
      if (here) glitch = Math.max(glitch, event.type === "spawn" ? 0.95 : 0.55);
    };

    const elimination = (event: { player: string; reason: string }) => {
      if (/KING OF SPADES/i.test(event.reason)) return;
      const victim = propsRef.current.players.find((p) => p.id === event.player);
      const roomCode = victim?.room_code ?? propsRef.current.you?.room_code ?? null;
      if (roomCode && roomCode !== propsRef.current.you?.room_code) return;
      spawnBlood(roomCode);
      glitch = Math.max(glitch, 0.8);
    };

    const buildRoomInto = (
      parent: THREE.Group, roomYou: You, offsetX: number, offsetZ: number,
      interactive: boolean, skipDir: Direction | null = null,
    ) => {
      parent.children.slice().forEach((c) => { parent.remove(c); disposeGroup(c); });
      kingGroup = null;
      kingEyes = [];
      kingLight = null;
      parent.position.set(offsetX, 0, offsetZ);
      const { arena, players, youId } = propsRef.current;
      if (!roomYou) return;

      const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      parent.add(floor);

      const grid = new THREE.GridHelper(H * 2, 6, 0xcac5b9, 0xd8d3c8);
      grid.position.y = 0.012;
      grid.userData.lockTint = true;
      parent.add(grid);

      const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), ceilMat);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.y = WH;
      parent.add(ceiling);

      const fixture = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 1.5),
        new THREE.MeshBasicMaterial({ color: 0xfff3da, transparent: true, opacity: 0.22 }),
      );
      fixture.rotation.x = Math.PI / 2;
      fixture.position.y = WH - 0.02;
      fixture.userData.lockTint = true;
      parent.add(fixture);

      const arenaSize = arena?.size ?? 5;
      const isExitRoom = !!roomYou.exit_code && roomYou.room_code === roomYou.exit_code;
      const exitDir = isExitRoom ? propsRef.current.exitWall[0] : undefined;
      for (const dir of DIRS) {
        if (dir === skipDir) continue;
        buildWall(
          parent, dir, roomYou.doors?.[dir], interactive,
          isEdgeDirection(roomYou.room, arenaSize, dir), dir === exitDir,
        );
      }

      const room = arena?.rooms.find((r) => r.code === roomYou.room_code);

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

      const mates = players.filter(
        (p) => p.room_code === roomYou.room_code && !p.eliminated && p.id !== youId
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
        const headMat = new THREE.MeshStandardMaterial({
          color: p.avatar_url ? 0xffffff : color,
          emissive: color,
          emissiveIntensity: p.locked ? 0.9 : 0.25,
          roughness: 0.5,
          metalness: 0.2,
          map: p.avatar_url ? avatarTexture(p.avatar_url) : null,
        });
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 18), headMat);
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
        g.userData.remotePlayer = p.id;
        parent.add(g);
      });

      if (propsRef.current.king?.room_code === roomYou.room_code) buildKing(parent);

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

    const clearPreview = (dir?: Direction) => {
      const dirs = dir ? [dir] : [...previewGroups.keys()];
      for (const key of dirs) {
        const group = previewGroups.get(key);
        if (!group) continue;
        scene.remove(group);
        disposeGroup(group);
        previewGroups.delete(key);
      }
    };

    const previewDestination = (dir: Direction, baseYou: You) => {
      const { arena } = propsRef.current;
      const current = arena?.rooms.find((room) => room.code === baseYou.room_code);
      const from = baseYou.room ?? (current ? [current.bx, current.by] as [number, number] : null);
      if (!from) return null;
      const v = outwardVector(dir);
      const target = arena?.rooms.find(
        (room) => room.bx === from[0] + v.x && room.by === from[1] + v.z,
      );
      return target ? roomYouFrom(baseYou, target) : null;
    };

    const buildPreview = (dir: Direction, destination: You) => {
      clearPreview(dir);
      const group = new THREE.Group();
      previewGroups.set(dir, group);
      scene.add(group);
      const v = outwardVector(dir);
      buildRoomInto(
        group, destination, v.x * ROOM_STEP, v.z * ROOM_STEP,
        false, OPPOSITE[dir],
      );
      const previewLight = new THREE.PointLight(0xfff2d8, 26, 14, 1.7);
      previewLight.position.set(0, WH - 0.4, 0);
      group.add(previewLight);
      const fill = new THREE.PointLight(0xbfd4ff, 8, 9, 2);
      fill.position.set(0, 1.4, 0);
      group.add(fill);
    };

    const resolveCrossDestination = (anim: CrossAnimation): You | null => {
      const { arena, you } = propsRef.current;
      if (!you) return null;
      if (anim.to && you.room_code === anim.to) return you;
      if (anim.to) {
        const room = arena?.rooms.find((r) => r.code === anim.to);
        if (room) return roomYouFrom(you, room);
      }
      const fromCode = anim.from ?? you.room_code;
      const origin = arena?.rooms.find((r) => r.code === fromCode)
        ?? arena?.rooms.find((r) => r.code === you.room_code);
      if (!origin) return null;
      const v = outwardVector(anim.dir);
      const target = arena?.rooms.find(
        (room) => room.bx === origin.bx + v.x && room.by === origin.by + v.z,
      );
      return target ? roomYouFrom(you, target) : null;
    };

    const rebuild = () => {
      if (crossAnim) return;
      const you = propsRef.current.you;
      if (!you) return;
      if (bloodRoomCode !== you.room_code) clearBlood();
      pickMeshes.length = 0;
      doorSlides.length = 0;
      doorTimers.length = 0;
      popups.length = 0;
      flashes.length = 0;
      clearPreview();
      buildRoomInto(roomGroup, you, 0, 0, true);
      for (const dir of DIRS) {
        const door = you.doors?.[dir];
        if (!door?.temporary_open || (door.open_until ?? 0) <= Date.now() / 1000) continue;
        const destination = previewDestination(dir, you);
        if (destination) buildPreview(dir, destination);
      }
    };

    const finishCross = (anim: CrossAnimation) => {
      clearPreview();
      const pose = entryPose(OPPOSITE[anim.dir]);
      freePos = { x: pose.x, z: pose.z };
      freeVel = { x: 0, z: 0 };
      lean = 0;
      crossLatch = null;
      crossLatchAt = 0;
      lastCrossSent = 0;
      crossAnim = null;
      rebuild();
    };

    const entered = (event: CrossEvent) => {
      if (propsRef.current.ghost) return;
      const dir = event.door ?? "N";
      const v = outwardVector(dir);
      const pose = entryPose(OPPOSITE[dir]);
      const start = new THREE.Vector3(freePos.x, 1.62, freePos.z);
      clearPreview();
      crossAnim = {
        startedAt: null,
        receivedAt: performance.now(),
        dir,
        from: event.from,
        to: event.to,
        current: start.clone(),
        start,
        gate: new THREE.Vector3(v.x * H, 1.62, v.z * H),
        end: new THREE.Vector3(v.x * ROOM_STEP + pose.x, 1.62, v.z * ROOM_STEP + pose.z),
        velocity: new THREE.Vector3(),
        yawFrom: yaw,
        yawTo: yawFor(dir),
      };
      pitch = 0;
      crossLatch = null;
      crossLatchAt = 0;
      lastCrossSent = 0;
    };

    const doorEvent = (event: DoorEventView) => {
      if (event.type === "lockdown") {
        playSound("lockdown");
        glitch = Math.max(glitch, 0.55);
        return;
      }
      const localDir = (): Direction | null => {
        const raw = event.door as Direction | undefined;
        if (!raw || !DIRS.includes(raw)) return null;
        const you = propsRef.current.you;
        if (!you) return null;
        if (event.room_code === you.room_code) return raw;
        if (event.target_code === you.room_code) return OPPOSITE[raw];
        return null;
      };
      if (event.type === "door_closed") {
        const dir = localDir();
        if (!dir) return;
        for (const slide of doorSlides) {
          if (slide.dir === dir) slide.open = false;
        }
        clearPreview(dir);
        return;
      }
      if (event.type === "door_result" && event.locked && event.message) {
        playSound("lockdown");
        glitch = Math.max(glitch, 0.55);
        return;
      }
      if (event.type === "door_result" && !event.accepted && event.message) {
        glitch = Math.max(glitch, 0.4);
        return;
      }
      if (event.type !== "door_opened" || !event.accepted) return;
      const dir = localDir();
      const you = propsRef.current.you;
      if (!dir || !you?.doors?.[dir]) return;
      if (!crossAnim) rebuild();
      for (const slide of doorSlides) {
        if (slide.dir === dir) slide.open = true;
      }
      if (!crossAnim) {
        const destination = previewDestination(dir, you);
        if (destination) buildPreview(dir, destination);
      }
      playSound("door");
      glitch = Math.max(glitch, 0.3);
    };

    const clearShiftMarkers = () => {
      shiftGroup.children.slice().forEach((c) => { shiftGroup.remove(c); disposeGroup(c); });
      shiftMarkers.length = 0;
    };

    const pulse = (moved: ShiftMove[]) => {
      glitch = 1;
      clearShiftMarkers();
      const you = propsRef.current.you;
      const arena = propsRef.current.arena;
      if (!you?.room || !arena) return;
      const [cx, cy] = you.room;
      const inBounds = (pos: [number, number]) =>
        pos[0] >= 0 && pos[1] >= 0 && pos[0] < arena.size && pos[1] < arena.size;
      for (const move of moved.slice(0, 8)) {
        if (!inBounds(move.from) || !inBounds(move.to)) continue;
        const from = new THREE.Vector3(
          (move.from[0] - cx) * ROOM_STEP, 0.045, (move.from[1] - cy) * ROOM_STEP,
        );
        const to = new THREE.Vector3(
          (move.to[0] - cx) * ROOM_STEP, 0.045, (move.to[1] - cy) * ROOM_STEP,
        );
        const mesh = new THREE.Mesh(
          new THREE.RingGeometry(0.42, 0.7, 28),
          new THREE.MeshBasicMaterial({
            color: 0x8fd0ff, transparent: true, opacity: 0.85,
            side: THREE.DoubleSide, depthWrite: false,
          }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.copy(from);
        shiftGroup.add(mesh);
        shiftMarkers.push({ mesh, born: performance.now(), from, to, duration: 900 });
      }
    };

    apiRef.current = { rebuild, pulse, entered, doorEvent, kingEvent, elimination };
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
    const isPointerLocked = () => document.pointerLockElement === renderer.domElement;

    const setPointerNdc = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

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
      if (propsRef.current.ghost || propsRef.current.you?.eliminated) return;
      const door = propsRef.current.you?.doors?.[dir];
      if (door?.temporary_open && (door.open_until ?? 0) > Date.now() / 1000) return;
      propsRef.current.onOpenDoor(dir);
    };

    const pick = () => {
      const dir = intersectDir(ndc);
      if (dir) openDoor(dir);
    };

    const onPointerEnter = (e: PointerEvent) => {
      pointerInside = true;
      pointerLast = { x: e.clientX, y: e.clientY };
    };

    const onPointerLeave = () => {
      if (!dragging) pointerInside = false;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (isPointerLocked() && e.pointerType === "mouse") {
        yaw -= e.movementX * LOOK_SENSITIVITY;
        pitch = Math.max(-1.2, Math.min(1.2, pitch - e.movementY * LOOK_SENSITIVITY));
        ndc.set(0, 0);
        return;
      }
      setPointerNdc(e);
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      if (!pointerInside) {
        pointerLast = { x: e.clientX, y: e.clientY };
        pointerInside = true;
      }
      if (dragging) {
        const dx = e.clientX - pointerLast.x;
        const dy = e.clientY - pointerLast.y;
        yaw -= dx * LOOK_SENSITIVITY;
        pitch = Math.max(-1.2, Math.min(1.2, pitch - dy * LOOK_SENSITIVITY));
        if (Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) > 6) {
          pointerMoved = true;
        }
        } else if (e.pointerType === "mouse") {
          renderer.domElement.style.cursor = !propsRef.current.ghost && intersectDir(ndc)
            ? "pointer" : "grab";
        }
      pointerLast = { x: e.clientX, y: e.clientY };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (activePointerId !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== renderer.domElement && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(active.tagName)) {
        active.blur();
      }
      unlockAudio();
      e.preventDefault();
      if (e.pointerType === "mouse" && !isPointerLocked()) {
        const request = renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
        if (request) request.catch(() => undefined);
      }
      setPointerNdc(e);
      activePointerId = e.pointerId;
      pointerDownAt = performance.now();
      pointerDown = { x: e.clientX, y: e.clientY };
      pointerLast = { x: e.clientX, y: e.clientY };
      pointerMoved = false;
      dragging = true;
      renderer.domElement.style.cursor = "grabbing";
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {}
    };

    const onPointerUp = (e: PointerEvent) => {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      if (isPointerLocked()) ndc.set(0, 0);
      if (!pointerMoved && performance.now() - pointerDownAt < 350) {
        if (!isPointerLocked()) setPointerNdc(e);
        pick();
      }
      if (activePointerId !== null) {
        try {
          renderer.domElement.releasePointerCapture(activePointerId);
        } catch {}
      }
      activePointerId = null;
      dragging = false;
      if (e.pointerType !== "mouse") pointerInside = false;
      renderer.domElement.style.cursor = isPointerLocked()
        ? "none"
        : !propsRef.current.ghost && intersectDir(ndc)
          ? "pointer" : "grab";
    };

    const onPointerCancel = () => {
      activePointerId = null;
      dragging = false;
      pointerInside = false;
      if (!isPointerLocked()) renderer.domElement.style.cursor = "grab";
    };

    const onBlur = () => {
      for (const k of Object.keys(keys)) keys[k] = false;
      activePointerId = null;
      dragging = false;
      pointerInside = false;
    };

    const onPointerLockChange = () => {
      const locked = isPointerLocked();
      setPointerLocked(locked);
      renderer.domElement.style.cursor = locked ? "none" : "grab";
      if (!locked) {
        activePointerId = null;
        dragging = false;
        pointerInside = false;
      }
    };

    const movementKeys = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        for (const k of Object.keys(keys)) keys[k] = false;
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(target?.tagName ?? "")) return;
      unlockAudio();
      const k = e.key.toLowerCase();
      if (propsRef.current.ghost) {
        if (k === "e" || k === "enter" || movementKeys.has(k)) e.preventDefault();
        return;
      }
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

    document.addEventListener("pointerlockchange", onPointerLockChange);
    renderer.domElement.addEventListener("pointerenter", onPointerEnter);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const nearOpenDoor = (pos: { x: number; z: number }, you: You | null, nowMs: number) => {
      if (propsRef.current.ghost || !you || you.eliminated) return null;
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
    const scratchPos = new THREE.Vector3();
    const desiredVel = new THREE.Vector3();
    let lastPoseSentAt = 0;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.1);
      const t = performance.now();
      const currentYou = propsRef.current.you;
      const lockTarget = currentYou?.locked ? 1 : 0;
      lockMix += (lockTarget - lockMix) * (1 - Math.exp(-dt * 5));
      if (Math.abs(lockTarget - lockMix) < 0.002) lockMix = lockTarget;

      if (crossAnim) {
        if (crossAnim.startedAt === null) {
          const destination = resolveCrossDestination(crossAnim);
          if (destination) {
            buildPreview(crossAnim.dir, destination);
            const pose = entryPose(OPPOSITE[crossAnim.dir]);
            const v = outwardVector(crossAnim.dir);
            crossAnim.end.set(v.x * ROOM_STEP + pose.x, 1.62, v.z * ROOM_STEP + pose.z);
            crossAnim.startedAt = t;
          } else if (t - crossAnim.receivedAt > CROSS_STATE_TIMEOUT) {
            finishCross(crossAnim);
          }
        }
        if (crossAnim && crossAnim.startedAt !== null) {
          const toEnd = scratchPos.copy(crossAnim.end).sub(crossAnim.current);
          const distance = toEnd.length();
          if (distance > 0.001) {
            desiredVel.copy(toEnd).normalize().multiplyScalar(CROSS_SPEED);
            crossAnim.velocity.lerp(desiredVel, 1 - Math.exp(-dt * CROSS_ACCEL));
          } else {
            crossAnim.velocity.multiplyScalar(Math.exp(-dt * CROSS_ACCEL));
          }
          crossAnim.current.addScaledVector(crossAnim.velocity, dt);
          const speed = crossAnim.velocity.length();
          if (speed > 0.6 && t - lastStepAt > 340) {
            lastStepAt = t;
            playSound("step");
          }
          const stepBob = Math.sin(t / 90) * 0.026 * Math.min(1, speed / CROSS_SPEED);
          camera.position.copy(crossAnim.current);
          camera.position.y = 1.62 + stepBob;
          yaw += shortestAngle(yaw, crossAnim.yawTo) * (1 - Math.exp(-dt * 7));
          camera.rotation.set(pitch, yaw, lean, "YXZ");
          const elapsed = t - crossAnim.startedAt;
          if ((distance < CROSS_FINISH_DISTANCE && speed < 1.1) || elapsed > CROSS_TIMEOUT) {
            finishCross(crossAnim);
          }
        }
      } else {
        let localX = 0;
        let localZ = 0;
        if (!propsRef.current.ghost) {
          if (keys.w || keys.arrowup) localZ -= 1;
          if (keys.s || keys.arrowdown) localZ += 1;
          if (keys.a || keys.arrowleft) localX -= 1;
          if (keys.d || keys.arrowright) localX += 1;
        }
        const moving = localX !== 0 || localZ !== 0;
        if (moving) {
          const length = Math.hypot(localX, localZ) || 1;
          localX /= length;
          localZ /= length;
        }
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);
        const targetX = (localX * cos + localZ * sin) * FREE_SPEED;
        const targetZ = (-localX * sin + localZ * cos) * FREE_SPEED;
        const blend = 1 - Math.exp(-dt * (moving ? WALK_ACCEL : WALK_DRAG));
        freeVel.x += (targetX - freeVel.x) * blend;
        freeVel.z += (targetZ - freeVel.z) * blend;
        const bound = H - 0.55;
        let nextX = freePos.x + freeVel.x * dt;
        let nextZ = freePos.z + freeVel.z * dt;
        if (nextX > bound) { nextX = bound; freeVel.x = 0; }
        if (nextX < -bound) { nextX = -bound; freeVel.x = 0; }
        if (nextZ > bound) { nextZ = bound; freeVel.z = 0; }
        if (nextZ < -bound) { nextZ = -bound; freeVel.z = 0; }
        freePos = { x: nextX, z: nextZ };
        if (crossLatch && t - crossLatchAt > CROSS_STATE_TIMEOUT) crossLatch = null;
        const nearDoor = nearOpenDoor(freePos, propsRef.current.you, Date.now());
        if (nearDoor !== crossLatch) {
          crossLatch = nearDoor;
          if (nearDoor) crossLatchAt = t;
          if (nearDoor && t - lastCrossSent >= CROSS_COOLDOWN) {
            lastCrossSent = t;
            propsRef.current.onCrossDoor(nearDoor);
          }
        }
        const speed = Math.hypot(freeVel.x, freeVel.z);
        if (speed > 0.6 && !propsRef.current.ghost && !currentYou?.eliminated && t - lastStepAt > 360) {
          lastStepAt = t;
          playSound("step");
        }
        const speedRatio = Math.min(1, speed / FREE_SPEED);
        bobPhase += dt * (7 + speed * 1.6);
        const bob = (Math.sin(bobPhase) * 0.024 + Math.sin(bobPhase * 0.5) * 0.006) * speedRatio
          + Math.sin(t / 900) * 0.003;
        const targetLean = -localX * 0.026 * speedRatio;
        lean += (targetLean - lean) * (1 - Math.exp(-dt * LEAN_SMOOTH));
        camera.position.set(freePos.x, 1.62 + bob, freePos.z);
        camera.rotation.set(pitch, yaw, lean, "YXZ");
      }

      if (!propsRef.current.ghost && currentYou && !currentYou.eliminated && t - lastPoseSentAt >= 66) {
        lastPoseSentAt = t;
        propsRef.current.onPose({
          x: Math.max(-H, Math.min(H, camera.position.x)),
          z: Math.max(-H, Math.min(H, camera.position.z)),
          yaw: camera.rotation.y,
          moving: Math.hypot(freeVel.x, freeVel.z) > 0.25 || !!crossAnim,
        });
      }

      const slideEase = 1 - Math.exp(-dt * 8);
      for (const slide of doorSlides) {
        const target = slide.baseX + (slide.open ? slide.span * 0.95 : 0);
        slide.leftPos += (-target - slide.leftPos) * slideEase;
        slide.rightPos += (target - slide.rightPos) * slideEase;
        slide.left.position.x = slide.leftPos;
        slide.right.position.x = slide.rightPos;
      }

      const nowSeconds = Date.now() / 1000;
      for (const timer of doorTimers) {
        const remaining = Math.max(0, timer.openUntil - nowSeconds);
        const text = `${remaining.toFixed(1)}s`;
        if (text !== timer.lastText) {
          timer.lastText = text;
          (timer.label.userData.setText as (value: string, color: string) => void)?.(
            text, remaining <= 3 ? "#e23b3b" : "#3f9f6b",
          );
        }
        timer.label.visible = remaining > 0;
      }

      scene.traverse((c) => {
        if (c.userData.remotePlayer) {
          const id = c.userData.remotePlayer as string;
          const target = propsRef.current.poses[id]
            ?? propsRef.current.players.find((p) => p.id === id)?.pose;
          if (target) {
            const ease = 1 - Math.exp(-dt * 12);
            c.position.x += (Math.max(-H, Math.min(H, target.x)) - c.position.x) * ease;
            c.position.z += (Math.max(-H, Math.min(H, target.z)) - c.position.z) * ease;
            c.rotation.y += shortestAngle(c.rotation.y, target.yaw) * ease;
            c.position.y = target.moving ? Math.abs(Math.sin(t / 105)) * 0.035 : 0;
          }
        }
        if (c.userData.led) {
          const mesh = c as THREE.Mesh;
          const mat = mesh.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
          if ("emissiveIntensity" in mat) mat.emissiveIntensity = 1.1 + Math.sin(t / 500) * 0.35;
          else mat.opacity = 0.4 + Math.sin(t / 500) * 0.15;
        }
        if (c.userData.lockTint) {
          const object = c as THREE.Mesh | THREE.LineSegments;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            const colorMat = material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial;
            const baseColor = (colorMat.userData.baseColor ?? colorMat.color.getHex()) as number;
            colorMat.userData.baseColor = baseColor;
            mixColor(colorMat.color, baseColor, LOCK_LIGHT, lockMix);
            const baseOpacity = (colorMat.userData.baseOpacity ?? colorMat.opacity) as number;
            colorMat.userData.baseOpacity = baseOpacity;
            colorMat.opacity = Math.min(1, baseOpacity + lockMix * 0.12);
          }
        }
      });

      if (kingGroup) {
        kingGroup.position.y = Math.sin(t / 420) * 0.045;
        kingGroup.rotation.y = Math.sin(t / 1300) * 0.11;
        for (const eye of kingEyes) {
          const mat = eye.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = 2.6 + Math.sin(t / 130) * 0.9;
        }
        if (kingLight) kingLight.intensity = 10 + Math.sin(t / 180) * 4;
      }

      for (let i = blood.length - 1; i >= 0; i -= 1) {
        const particle = blood[i];
        const age = (t - particle.born) / particle.life;
        if (age >= 1) {
          scene.remove(particle.mesh);
          particle.mesh.geometry.dispose();
          (particle.mesh.material as THREE.Material).dispose();
          blood.splice(i, 1);
          continue;
        }
        particle.mesh.position.addScaledVector(particle.velocity, dt);
        particle.velocity.y -= 6.2 * dt;
        if (particle.mesh.position.y < 0.02) {
          particle.mesh.position.y = 0.02;
          particle.velocity.set(0, 0, 0);
        }
        particle.mesh.scale.setScalar(1 - age * 0.55);
        (particle.mesh.material as THREE.MeshStandardMaterial).opacity = 0.96 * (1 - age);
      }

      for (let i = bloodPools.length - 1; i >= 0; i -= 1) {
        const pool = bloodPools[i];
        const age = (t - pool.born) / pool.life;
        if (age >= 1) {
          scene.remove(pool.mesh);
          pool.mesh.geometry.dispose();
          (pool.mesh.material as THREE.Material).dispose();
          bloodPools.splice(i, 1);
          continue;
        }
        (pool.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * Math.pow(1 - age, 1.6);
      }

      for (let i = shiftMarkers.length - 1; i >= 0; i -= 1) {
        const marker = shiftMarkers[i];
        const age = (t - marker.born) / marker.duration;
        if (age >= 1) {
          shiftGroup.remove(marker.mesh);
          marker.mesh.geometry.dispose();
          (marker.mesh.material as THREE.Material).dispose();
          shiftMarkers.splice(i, 1);
          continue;
        }
        const ease = age * age * (3 - 2 * age);
        marker.mesh.position.lerpVectors(marker.from, marker.to, ease);
        marker.mesh.scale.setScalar(1 + ease * 1.2);
        (marker.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - age);
      }

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
        const rise = 1 - (1 - age) * (1 - age);
        popup.sprite.position.y = popup.baseY + rise * 0.9;
        const scale = 1.05 + Math.sin(age * Math.PI) * 0.32;
        popup.sprite.scale.set(scale, scale * 0.375, 1);
        popup.sprite.material.opacity = Math.pow(1 - age, 1.5);
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
        flash.mesh.scale.setScalar(1 + (1 - Math.exp(-age * 4)) * 1.1);
        (flash.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * Math.pow(1 - age, 2);
      }

      glitch = Math.max(0, glitch - dt * 1.8);
      mixColor(wallMat.color, WHITE, LOCK_WALL, lockMix);
      mixColor(floorMat.color, 0xe7e3da, LOCK_FLOOR, lockMix);
      mixColor(ceilMat.color, 0xdfdbd2, LOCK_CEIL, lockMix);
      mixColor(wallMat.emissive, 0xffffff, LOCK_LIGHT, lockMix);
      wallMat.emissiveIntensity = glitch * 0.35 + lockMix * 0.12;
      floorMat.emissive.setHex(LOCK_LIGHT);
      floorMat.emissiveIntensity = lockMix * 0.08;
      ceilMat.emissive.setHex(LOCK_LIGHT);
      ceilMat.emissiveIntensity = lockMix * 0.08;
      mixColor(hemi.color, 0xffffff, LOCK_LIGHT, lockMix);
      mixColor(hemi.groundColor, 0x1a1c20, 0x330004, lockMix);
      mixColor(key.color, 0xffffff, LOCK_LIGHT, lockMix);
      mixColor(centerLight.color, 0xfff2d8, LOCK_LIGHT, lockMix);
      mixColor(glowLight.color, 0xbfd4ff, LOCK_LIGHT, lockMix);
      hemi.intensity = 1.05 + lockMix * 0.25;
      key.intensity = 0.9 + lockMix * 0.45;
      centerLight.intensity = 22 + lockMix * 8;
      glowLight.intensity = 8 + glitch * 30 + lockMix * 10;
      if (scene.background instanceof THREE.Color) mixColor(scene.background, INK, LOCK_FOG, lockMix);
      if (scene.fog) mixColor(scene.fog.color, INK, LOCK_FOG, lockMix);
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      if (isPointerLocked()) document.exitPointerLock();
      renderer.domElement.removeEventListener("pointerenter", onPointerEnter);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      clearBlood();
      clearShiftMarkers();
      avatarTextures.forEach((texture) => texture.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (props.cross.id > 0 && props.cross.id !== lastCrossId.current) {
      lastCrossId.current = props.cross.id;
      if (!props.cross.player || props.cross.player === props.you?.id) apiRef.current?.entered(props.cross);
    }
  }, [props.cross, props.you?.id]);

  useEffect(() => {
    if (props.doorEvent && props.doorEvent.id !== lastDoorEventId.current) {
      lastDoorEventId.current = props.doorEvent.id;
      apiRef.current?.doorEvent(props.doorEvent);
    }
  }, [props.doorEvent]);

  useEffect(() => {
    if (props.kingEvent && props.kingEvent.id !== lastKingEventId.current) {
      lastKingEventId.current = props.kingEvent.id;
      apiRef.current?.kingEvent(props.kingEvent);
    }
  }, [props.kingEvent]);

  useEffect(() => {
    if (props.elimination && props.elimination.id !== lastEliminationId.current) {
      lastEliminationId.current = props.elimination.id;
      apiRef.current?.elimination(props.elimination);
    }
  }, [props.elimination]);

  useEffect(() => {
    apiRef.current?.rebuild();
  }, [arenaSig, doorSig, props.you?.room_code, props.you?.room?.[0], props.you?.room?.[1], props.you?.exit_found, props.you?.exit_code, props.exitWall.join("|"), playerSig, kingSig]);

  useEffect(() => {
    if (props.transitionId > 0 && props.transitionId !== lastShiftPulseId.current) {
      lastShiftPulseId.current = props.transitionId;
      apiRef.current?.pulse(props.moved);
    }
  }, [props.transitionId, props.moved]);

  return (
    <div className="absolute inset-0">
      <div ref={mountRef} className="absolute inset-0 cursor-grab select-none" />
      {pointerLocked && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="h-1.5 w-1.5 rounded-full border border-bone/80 bg-void/60 shadow-[0_0_6px_rgba(0,0,0,0.9)]" />
        </div>
      )}
    </div>
  );
}
