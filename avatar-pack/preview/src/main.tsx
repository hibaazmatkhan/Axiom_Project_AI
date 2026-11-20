import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import joker from "../../assets/pfp/joker.png";
import spade from "../../assets/pfp/spade.png";
import club from "../../assets/pfp/club.png";
import heart from "../../assets/pfp/heart.png";
import diamond from "../../assets/pfp/diamond.png";
import type { CharacterId, CharacterRuntimeState, PfpPresetId } from "../../contracts/avatar.types";
import { CHARACTER_IDS, CHARACTER_REGISTRY, DEFAULT_CHARACTER_ID, getCharacterSpec } from "../../frontend/characters/CharacterRegistry";
import { createCharacterModel } from "../../frontend/characters/createCharacterModel";
import type { CharacterModel } from "../../frontend/characters/types";
import { PFP_PRESETS } from "../../frontend/pfp/pfpCatalog";

const PFP_FILES: Record<PfpPresetId, string> = { joker, spade, club, heart, diamond };

const MODES = [
  { id: "ready", label: "Ready" },
  { id: "moving", label: "Moving" },
  { id: "locked", label: "Locked" },
  { id: "eliminated", label: "Eliminated" },
  { id: "escaped", label: "Escaped" },
] as const;

type ModeKey = (typeof MODES)[number]["id"];

const COLORS = {
  background: "#080a0d",
  panel: "#11151b",
  panelAlt: "#161b22",
  border: "#2c333d",
  gold: "#f4c542",
  bone: "#ece3d2",
  dim: "#8e97a3",
  cyan: "#6ec7d8",
};

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  padding: "32px",
  background: `radial-gradient(circle at 20% 0%, #18202a 0%, ${COLORS.background} 55%)`,
};

const shellStyle: CSSProperties = {
  maxWidth: 1280,
  margin: "0 auto",
};

const panelStyle: CSSProperties = {
  background: COLORS.panel,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 16,
  padding: 20,
};

const monoStyle: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 10,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: COLORS.gold,
};

function hex(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
  } else {
    material.dispose();
  }
}

type CharacterStageProps = {
  characterId: CharacterId;
  state: CharacterRuntimeState;
};

function CharacterStage({ characterId, state }: CharacterStageProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const modelRef = useRef<CharacterModel | null>(null);
  const setStateRef = useRef<((patch: Partial<CharacterRuntimeState>) => void) | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0e12);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(2.1, 1.95, 3.35);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.9, 0);
    controls.enableDamping = true;
    controls.minDistance = 1.8;
    controls.maxDistance = 6;
    controls.maxPolarAngle = Math.PI * 0.49;

    const ambient = new THREE.HemisphereLight(0xffe6b8, 0x11151c, 1.4);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 5, 4);
    key.castShadow = true;
    const rim = new THREE.DirectionalLight(COLORS.cyan, 1.1);
    rim.position.set(-3, 2, -4);
    scene.add(ambient, key, rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 48),
      new THREE.MeshStandardMaterial({ color: 0x15191f, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(4, 16, 0x3a3f48, 0x242830);
    grid.position.y = 0.005;
    scene.add(grid);

    const resize = () => {
      const width = mount.clientWidth || 640;
      const height = mount.clientHeight || 480;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let frame = 0;
    let last = performance.now();
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const now = performance.now();
      const delta = now - last;
      last = now;
      modelRef.current?.update(delta);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      floor.geometry.dispose();
      disposeMaterial(floor.material);
      grid.geometry.dispose();
      disposeMaterial(grid.material);
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const model = createCharacterModel(getCharacterSpec(characterId), stateRef.current);
    model.group.rotation.y = Math.PI * 0.08;
    scene.add(model.group);
    modelRef.current = model;
    setStateRef.current = model.setState;

    return () => {
      scene.remove(model.group);
      model.dispose();
      if (modelRef.current === model) {
        modelRef.current = null;
        setStateRef.current = null;
      }
    };
  }, [characterId]);

  useEffect(() => {
    setStateRef.current?.(state);
  }, [state]);

  return <div ref={mountRef} style={{ width: "100%", height: 520, borderRadius: 12, overflow: "hidden" }} />;
}

function App() {
  const [characterId, setCharacterId] = useState<CharacterId>(DEFAULT_CHARACTER_ID);
  const [mode, setMode] = useState<ModeKey>("ready");

  const state = useMemo<CharacterRuntimeState>(
    () => ({
      connected: true,
      ready: mode === "ready",
      moving: mode === "moving",
      locked: mode === "locked",
      eliminated: mode === "eliminated",
      escaped: mode === "escaped",
    }),
    [mode]
  );

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <header style={{ marginBottom: 20 }}>
          <p style={monoStyle}>AXIOM / Avatar Pack Preview</p>
          <h1 style={{ margin: "8px 0 6px", fontSize: 28 }}>Broadcast roster and PFP shelf</h1>
          <p style={{ margin: 0, color: COLORS.dim, fontSize: 13 }}>
            Local-only preview. No Firebase, Supabase, backend, or original app code is used.
          </p>
        </header>

        <section style={{ ...panelStyle, marginBottom: 18 }}>
          <p style={monoStyle}>Profile images</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 14 }}>
            {PFP_PRESETS.map((preset) => (
              <figure
                key={preset.id}
                style={{
                  margin: 0,
                  width: 116,
                  padding: 10,
                  background: COLORS.panelAlt,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 10,
                  textAlign: "center",
                }}
              >
                <img
                  src={PFP_FILES[preset.id]}
                  alt={preset.label}
                  style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: `1px solid ${COLORS.gold}` }}
                />
                <figcaption style={{ marginTop: 8, color: COLORS.bone, fontSize: 12 }}>{preset.label}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(420px, 1.5fr)", gap: 18 }}>
          <section style={panelStyle}>
            <p style={monoStyle}>Full-coverage roster</p>
            <h2 style={{ margin: "8px 0 14px", fontSize: 18 }}>Select a 3D avatar</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
              {CHARACTER_IDS.map((id) => {
                const spec = CHARACTER_REGISTRY[id];
                const active = id === characterId;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setCharacterId(id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: 8,
                      color: active ? COLORS.bone : COLORS.dim,
                      background: active ? "#202833" : COLORS.panelAlt,
                      border: `1px solid ${active ? COLORS.gold : COLORS.border}`,
                      borderRadius: 8,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        flex: "0 0 28px",
                        display: "grid",
                        placeItems: "center",
                        borderRadius: 6,
                        background: `linear-gradient(145deg, ${hex(spec.palette.primary)}, ${hex(spec.palette.accent)})`,
                        color: COLORS.background,
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {spec.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 12 }}>{spec.name}</span>
                      <span style={{ display: "block", color: COLORS.dim, fontSize: 9 }}>{id}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <p style={{ ...monoStyle, marginTop: 20 }}>Animation state</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMode(item.id)}
                  style={{
                    padding: "6px 10px",
                    color: mode === item.id ? COLORS.background : COLORS.dim,
                    background: mode === item.id ? COLORS.gold : COLORS.panelAlt,
                    border: `1px solid ${mode === item.id ? COLORS.gold : COLORS.border}`,
                    borderRadius: 999,
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <p style={{ marginTop: 20, color: COLORS.dim, fontSize: 11, lineHeight: 1.6 }}>
              Drag to orbit, scroll to zoom. Character geometry stays full-coverage: clothed torso, sleeves, and legs; skin only on the face.
            </p>
          </section>

          <section style={panelStyle}>
            <p style={monoStyle}>Three.js stage</p>
            <h2 style={{ margin: "8px 0 14px", fontSize: 18 }}>{CHARACTER_REGISTRY[characterId].name}</h2>
            <CharacterStage characterId={characterId} state={state} />
          </section>
        </div>
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(<App />);
