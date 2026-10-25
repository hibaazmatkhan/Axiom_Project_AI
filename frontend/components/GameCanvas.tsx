"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Maze, Player } from "@/lib/types";

type Move = { bx: number; by: number; symbol?: string };

type Props = {
  maze: Maze | null;
  prevMaze: Maze | null;
  players: Player[];
  youId: string | null;
  transitionId: number;
  moved: Move[];
  role: string;
  stage: number;
  won: boolean;
};

const SYMBOL_COLORS: Record<string, number> = {
  triangle: 0xff8a3d, circle: 0x3dd6ff, square: 0xb86bff,
};
const MATERIAL_EMISSIVE: Record<string, number> = {
  stone: 0x0c1840, glass: 0x123a4a, rune: 0x2a1550,
};

function makeAvatar(color: string, isYou: boolean) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.5, roughness: 0.35, metalness: 0.2,
  });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.22, 20), mat);
  base.position.y = 0.11;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.34, 6, 14), mat);
  body.position.y = 0.5;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 18), mat);
  head.position.y = 0.92;
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.08, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9 })
  );
  visor.position.set(0, 0.94, 0.17);
  g.add(base, body, head, visor);
  if (isYou) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.028, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);
  }
  return g;
}

export default function GameCanvas(props: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const apiRef = useRef<{ rebuild: () => void; flash: (moves: Move[]) => void } | null>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05060f);
    scene.fog = new THREE.Fog(0x05060f, 12, 34);

    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0x8899ff, 0x05060f, 0.7));
    const sun = new THREE.DirectionalLight(0xbfd4ff, 1.0);
    sun.position.set(8, 16, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);
    const rim = new THREE.PointLight(0x3dd6ff, 1.2, 20);
    scene.add(rim);

    const mazeGroup = new THREE.Group();
    scene.add(mazeGroup);
    const playerMeshes = new Map<string, THREE.Group>();
    const highlights: { mesh: THREE.Mesh; life: number }[] = [];
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1b2751, emissive: 0x0a1230, emissiveIntensity: 0.7, roughness: 0.55, metalness: 0.15,
    });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x0a0e22, roughness: 0.95 });
    let glitch = 0;

    const toWorld = (x: number, y: number, n: number) =>
      new THREE.Vector3(x - n / 2 + 0.5, 0, y - n / 2 + 0.5);

    const rebuild = () => {
      const maze = propsRef.current.maze;
      if (!maze) return;
      mazeGroup.children.slice().forEach((c) => {
        mazeGroup.remove(c);
        const m = c as THREE.Mesh;
        m.geometry?.dispose();
      });
      const n = maze.tile_size;
      const B = maze.block;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(n + 1, n + 1), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.02;
      floor.receiveShadow = true;
      mazeGroup.add(floor);

      let count = 0;
      maze.tiles.forEach((row) => { for (const ch of row) if (ch === "#") count++; });
      const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1.4, 1), wallMat, count);
      walls.castShadow = true;
      const dummy = new THREE.Object3D();
      let i = 0;
      maze.tiles.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          if (row[x] !== "#") continue;
          const p = toWorld(x, y, n);
          dummy.position.set(p.x, 0.7, p.z);
          dummy.updateMatrix();
          walls.setMatrixAt(i++, dummy.matrix);
        }
      });
      mazeGroup.add(walls);

      // Archivist overlay: the previous configuration, drawn as a faint ghost so
      // this role can diff two states without being told what moved.
      const prev = propsRef.current.prevMaze;
      if (prev && prev.tile_size === n) {
        let gcount = 0;
        prev.tiles.forEach((row) => { for (const ch of row) if (ch === "#") gcount++; });
        const ghostMat = new THREE.MeshBasicMaterial({
          color: 0xb86bff, transparent: true, opacity: 0.16, depthWrite: false,
        });
        const ghost = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1.4, 1), ghostMat, gcount);
        let gi = 0;
        prev.tiles.forEach((row, y) => {
          for (let x = 0; x < row.length; x++) {
            if (row[x] !== "#") continue;
            const p = toWorld(x, y, n);
            dummy.position.set(p.x, 0.7, p.z);
            dummy.updateMatrix();
            ghost.setMatrixAt(gi++, dummy.matrix);
          }
        });
        ghost.instanceMatrix.needsUpdate = true;
        mazeGroup.add(ghost);
      }

      for (const b of maze.blocks) {
        const geo =
          b.symbol === "triangle" ? new THREE.CircleGeometry(0.42, 3)
          : b.symbol === "circle" ? new THREE.CircleGeometry(0.42, 36)
          : new THREE.PlaneGeometry(0.7, 0.7);
        const mark = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({
            color: SYMBOL_COLORS[b.symbol], emissive: SYMBOL_COLORS[b.symbol],
            emissiveIntensity: MATERIAL_EMISSIVE[b.material] ? 1.4 : 0.9,
          })
        );
        mark.rotation.x = -Math.PI / 2;
        const p = toWorld(b.bx * B + Math.floor(B / 2), b.by * B + Math.floor(B / 2), n);
        mark.position.set(p.x, 0.02, p.z);
        mazeGroup.add(mark);
      }

      const exit = toWorld(maze.exit[0], maze.exit[1], n);
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 3.2, 24),
        new THREE.MeshBasicMaterial({ color: 0x5bffb0, transparent: true, opacity: 0.28 })
      );
      beacon.position.set(exit.x, 1.6, exit.z);
      beacon.userData.beacon = true;
      mazeGroup.add(beacon);
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.75, 32),
        new THREE.MeshBasicMaterial({ color: 0x5bffb0, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(exit.x, 0.03, exit.z);
      mazeGroup.add(halo);
    };

    const flash = (moves: Move[]) => {
      glitch = 1;
      const { maze, role } = propsRef.current;
      if (!maze) return;
      const n = maze.tile_size;
      const B = maze.block;
      for (const r of moves) {
        const p = toWorld(r.bx * B + (B - 1) / 2, r.by * B + (B - 1) / 2, n);
        const color = role === "symbolist" && r.symbol ? SYMBOL_COLORS[r.symbol] : 0xffffff;
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(B * 0.96, B * 0.96),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 })
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(p.x, 0.05, p.z);
        scene.add(mesh);
        highlights.push({ mesh, life: 1 });
      }
    };
    apiRef.current = { rebuild, flash };
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

    const clock = new THREE.Clock();
    const camTarget = new THREE.Vector3();
    let camInit = false;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.1);
      const { maze, players, youId, stage } = propsRef.current;
      if (maze) {
        const n = maze.tile_size;
        const seen = new Set<string>();
        for (const p of players) {
          seen.add(p.id);
          const target = toWorld(p.x, p.y, n);
          let g = playerMeshes.get(p.id);
          if (!g) {
            g = makeAvatar(p.color, p.id === youId);
            g.position.copy(target);
            playerMeshes.set(p.id, g);
            scene.add(g);
          }
          g.position.lerp(target, 1 - Math.exp(-14 * dt));
          (g.children[1] as THREE.Mesh).position.y = 0.5 + Math.sin(performance.now() / 300 + p.slot) * 0.03;
        }
        playerMeshes.forEach((g, id) => {
          if (!seen.has(id)) { scene.remove(g); playerMeshes.delete(id); }
        });
        const me = youId ? playerMeshes.get(youId) : undefined;
        const focus = me ? me.position : new THREE.Vector3(0, 0, 0);
        if (!camInit) { camTarget.copy(focus); camInit = true; }
        camTarget.lerp(focus, 1 - Math.exp(-6 * dt));
        const shake = (Math.random() - 0.5) * 0.25 * glitch;
        camera.position.set(camTarget.x + shake, 9.5 + stage * 0.1, camTarget.z + 8);
        camera.lookAt(camTarget.x, 0.5, camTarget.z);
        rim.position.set(camTarget.x, 3, camTarget.z);
      }
      glitch = Math.max(0, glitch - dt * 1.6);
      wallMat.emissiveIntensity = 0.7 + glitch * 2.6;
      for (let i = highlights.length - 1; i >= 0; i--) {
        const h = highlights[i];
        h.life -= dt / 1.6;
        (h.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, h.life) * 0.55;
        if (h.life <= 0) { scene.remove(h.mesh); h.mesh.geometry.dispose(); highlights.splice(i, 1); }
      }
      // pulse the beacon
      mazeGroup.children.forEach((c) => {
        if (c.userData.beacon) {
          (c as THREE.Mesh).scale.y = 1 + Math.sin(performance.now() / 500) * 0.06;
        }
      });
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
  }, []);

  useEffect(() => { apiRef.current?.rebuild(); }, [props.maze, props.prevMaze]);
  useEffect(() => {
    if (props.transitionId > 0) apiRef.current?.flash(props.moved);
  }, [props.transitionId, props.moved]);

  return <div ref={mountRef} className="absolute inset-0" />;
}
