"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Arena, CrossEvent, Direction, Door, DoorColor, Player, You } from "@/lib/types";

type DoorEventView = {
  id: number;
  type: "door_result" | "door_opened" | "door_closed" | "lockdown";
  accepted: boolean;
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
  moved: { from: [number, number]; to: [number, number]; code_from: string; code_to: string }[];
  cross: CrossEvent;
  doorEvent: DoorEventView | null;
  onOpenDoor: (dir: Direction) => void;
  onCrossDoor: (dir: Direction) => void;
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
    return `${room.code}:${room.bx}:${room.by}:${room.sigil}:${room.sanction}:${room.revealed}:${room.future}:${doors}:${open}`;
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
  const propsRef = useRef(props);
  propsRef.current = props;
  const apiRef = useRef<{
    rebuild: () => void;
    pulse: () => void;
    entered: (event: CrossEvent) => void;
    doorEvent: (event: DoorEventView) => void;
  } | null>(null);
  const lastCrossId = useRef(0);
  const lastDoorEventId = useRef(0);
  const arenaSig = arenaSignature(props.arena);
  const doorSig = doorSignature(props.you?.doors);
  const playerSig = playerSignature(props.players);

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

    const pickMeshes: THREE.Mesh[] = [];
    const popups: { sprite: THREE.Sprite; born: number; baseY: number }[] = [];
    const flashes: { mesh: THREE.Mesh; born: number }[] = [];
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
    let viewEnabled = false;
    let pointerInside = false;
    let activePointerId: number | null = null;
    let pointerDownAt = 0;
    let pointerDown = { x: 0, y: 0 };
    let pointerLast = { x: 0, y: 0 };
    let pointerMoved = false;
    let crossLatch: Direction | null = null;
    let crossLatchAt = 0;
    let lastCrossSent = 0;
    let nextGroup: THREE.Group | null = null;
    let crossAnim: CrossAnimation | null = null;
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
      interactive: boolean, edge: boolean,
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
      const darkMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(hex).multiplyScalar(0.72),
        emissive: hex, emissiveIntensity: 0.4, roughness: 0.5, metalness: 0.2,
      });
      const halfW = (DW - 0.08) / 2;
      const left = addBox(group, halfW, DH - 0.05, 0.06, -halfW / 2, DH / 2, 0.06, panelMat);
      const right = addBox(group, halfW, DH - 0.05, 0.06, halfW / 2, DH / 2, 0.06, panelMat);
      [left, right].forEach((panel, i) => {
        addBox(panel, halfW * 0.72, 0.07, 0.02, 0, 0.5, 0.04, lightMat);
        addBox(panel, halfW * 0.72, 0.07, 0.02, 0, -0.5, 0.04, darkMat);
        addBox(
          panel, 0.08, 0.42, 0.03,
          i === 0 ? halfW / 2 - 0.12 : -halfW / 2 + 0.12, 0, 0.05, lightMat,
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

    const buildRoomInto = (
      parent: THREE.Group, roomYou: You, offsetX: number, offsetZ: number,
      interactive: boolean, skipDir: Direction | null = null,
    ) => {
      parent.children.slice().forEach((c) => { parent.remove(c); disposeGroup(c); });
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
      for (const dir of DIRS) {
        if (dir === skipDir) continue;
        buildWall(
          parent, dir, roomYou.doors?.[dir], interactive,
          isEdgeDirection(roomYou.room, arenaSize, dir),
        );
      }

      const room = arena?.rooms.find((r) => r.code === roomYou.room_code);

      if (roomYou.room_code && roomYou.room_code === roomYou.exit_code) {
        const hex = 0x3f9f6b;
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
          new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.16, side: THREE.DoubleSide })
        );
        pillar.position.y = WH / 2;
        pillar.userData.beacon = true;
        parent.add(pillar);
        const label = makeLabel("EXIT", "#3f9f6b", 0.9);
        label.position.set(0, 1.65, 0);
        label.userData.beacon = true;
        parent.add(label);
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

    const clearNextGroup = () => {
      if (!nextGroup) return;
      scene.remove(nextGroup);
      disposeGroup(nextGroup);
      nextGroup = null;
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
      clearNextGroup();
      nextGroup = new THREE.Group();
      scene.add(nextGroup);
      const v = outwardVector(dir);
      buildRoomInto(
        nextGroup, destination, v.x * ROOM_STEP, v.z * ROOM_STEP,
        false, OPPOSITE[dir],
      );
      const previewLight = new THREE.PointLight(0xfff2d8, 18, 10, 2);
      previewLight.position.set(0, WH - 0.4, 0);
      nextGroup.add(previewLight);
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
      pickMeshes.length = 0;
      doorSlides.length = 0;
      doorTimers.length = 0;
      popups.length = 0;
      flashes.length = 0;
      clearNextGroup();
      buildRoomInto(roomGroup, you, 0, 0, true);
      const openDir = DIRS.find((dir) => {
        const door = you.doors?.[dir];
        return !!door?.temporary_open && (door.open_until ?? 0) > Date.now() / 1000;
      });
      if (openDir) {
        const destination = previewDestination(openDir, you);
        if (destination) buildPreview(openDir, destination);
      }
    };

    const finishCross = (anim: CrossAnimation) => {
      clearNextGroup();
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
      const dir = event.door ?? "N";
      const v = outwardVector(dir);
      const pose = entryPose(OPPOSITE[dir]);
      const start = new THREE.Vector3(freePos.x, 1.62, freePos.z);
      clearNextGroup();
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
        for (const slide of doorSlides) {
          if (dir && slide.dir !== dir) continue;
          slide.open = false;
        }
        clearNextGroup();
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
      glitch = Math.max(glitch, 0.3);
    };

    apiRef.current = { rebuild, pulse: () => { glitch = 1; }, entered, doorEvent };
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
      pointerInside = false;
    };

    const onPointerMove = (e: PointerEvent) => {
      setPointerNdc(e);
      if (e.pointerType === "mouse") {
        if (!viewEnabled) return;
        yaw -= e.movementX * LOOK_SENSITIVITY;
        pitch = Math.max(-1.2, Math.min(1.2, pitch - e.movementY * LOOK_SENSITIVITY));
        return;
      }
      if (dragging && activePointerId !== null && e.pointerId !== activePointerId) return;
      if (!pointerInside) {
        pointerLast = { x: e.clientX, y: e.clientY };
        pointerInside = true;
        return;
      }
      const dx = e.clientX - pointerLast.x;
      const dy = e.clientY - pointerLast.y;
      pointerLast = { x: e.clientX, y: e.clientY };
      if (dragging) {
        yaw -= dx * LOOK_SENSITIVITY;
        pitch = Math.max(-1.2, Math.min(1.2, pitch - dy * LOOK_SENSITIVITY));
      }
      if (dragging && Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) > 6) {
        pointerMoved = true;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (activePointerId !== null) return;
      setPointerNdc(e);
      activePointerId = e.pointerId;
      pointerDownAt = performance.now();
      pointerDown = { x: e.clientX, y: e.clientY };
      pointerLast = { x: e.clientX, y: e.clientY };
      pointerMoved = false;
      dragging = e.pointerType !== "mouse";
      if (e.pointerType === "mouse") {
        viewEnabled = true;
        pick();
      } else {
        try {
          renderer.domElement.setPointerCapture(e.pointerId);
        } catch {}
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      if (e.pointerType !== "mouse" && !pointerMoved && performance.now() - pointerDownAt < 350) {
        setPointerNdc(e);
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
    };

    const onPointerCancel = () => {
      activePointerId = null;
      dragging = false;
      pointerInside = false;
    };

    const onBlur = () => {
      for (const k of Object.keys(keys)) keys[k] = false;
      viewEnabled = false;
      activePointerId = null;
      dragging = false;
      pointerInside = false;
    };

    const movementKeys = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        viewEnabled = false;
        return;
      }
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
    const scratchPos = new THREE.Vector3();
    const desiredVel = new THREE.Vector3();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.1);
      const t = performance.now();
      const currentYou = propsRef.current.you;
      const lockedHere = !!currentYou?.locked || propsRef.current.players.some(
        (p) => p.locked && !p.eliminated && p.room_code === currentYou?.room_code,
      );
      const lockTarget = lockedHere ? 1 : 0;
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
        if (keys.w || keys.arrowup) localZ -= 1;
        if (keys.s || keys.arrowdown) localZ += 1;
        if (keys.a || keys.arrowleft) localX -= 1;
        if (keys.d || keys.arrowright) localX += 1;
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
        const nearDoor = nearOpenDoor(freePos, propsRef.current.you, t);
        if (nearDoor !== crossLatch) {
          crossLatch = nearDoor;
          if (nearDoor) crossLatchAt = t;
          if (nearDoor && t - lastCrossSent >= CROSS_COOLDOWN) {
            lastCrossSent = t;
            propsRef.current.onCrossDoor(nearDoor);
          }
        }
        const speed = Math.hypot(freeVel.x, freeVel.z);
        const speedRatio = Math.min(1, speed / FREE_SPEED);
        bobPhase += dt * (7 + speed * 1.6);
        const bob = (Math.sin(bobPhase) * 0.024 + Math.sin(bobPhase * 0.5) * 0.006) * speedRatio
          + Math.sin(t / 900) * 0.003;
        const targetLean = -localX * 0.026 * speedRatio;
        lean += (targetLean - lean) * (1 - Math.exp(-dt * LEAN_SMOOTH));
        camera.position.set(freePos.x, 1.62 + bob, freePos.z);
        camera.rotation.set(pitch, yaw, lean, "YXZ");
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
      renderer.domElement.removeEventListener("pointerenter", onPointerEnter);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
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
    apiRef.current?.rebuild();
  }, [arenaSig, doorSig, props.you?.room_code, props.you?.room?.[0], props.you?.room?.[1], props.you?.exit_found, props.you?.exit_code, playerSig]);

  useEffect(() => {
    if (props.transitionId > 0) apiRef.current?.pulse();
  }, [props.transitionId]);

  return <div ref={mountRef} className="absolute inset-0 cursor-crosshair" />;
}
