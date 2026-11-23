import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const client = read("../components/GameClient.tsx");
const canvas = read("../components/GameCanvas.tsx");
const socket = read("../lib/useGameSocket.ts");
const nextConfig = read("../next.config.mjs");
const backendProxyRoute = read("../app/backend/[...path]/route.ts");
const vercel = read("../../vercel.json");
const frontendVercel = read("../vercel.json");
const rootPackage = read("../../package.json");
const game = read("../../backend/app/game.py");
const fate = read("../../backend/app/fate.py");
const registry = read("../../backend/app/room_registry.py");
const main = read("../../backend/app/main.py");
const lobby = read("../app/lobby/page.tsx");
const profileProvider = read("../components/ProfileProvider.tsx");
const login = read("../app/login/page.tsx");
const avatarRules = read("../lib/avatarRules.ts");
const landing = read("../app/page.tsx");
const guest = read("../lib/guest.ts");
const gameLoader = read("../app/game/GameLoader.tsx");
const roles = read("../../backend/app/roles.py");
const arena = read("../../backend/app/arena.py");

test("tier-2 delay puzzle is answerable", () => {
  assert.ok(client.includes('puzzle.tier === 2 ? "Grid · tap destination" : "Before"'));
  assert.ok(client.includes("onPick={interactive && puzzle.tier === 2 ? onAnswer : undefined}"));
});

test("ghost mode blocks gameplay actions", () => {
  assert.ok(client.includes("if (!ghost) sendWait();"));
  assert.ok(client.includes("ghost={ghost}"));
  assert.ok(canvas.includes("if (propsRef.current.ghost || propsRef.current.you?.eliminated) return;"));
  assert.ok(canvas.includes("if (propsRef.current.ghost || !you || you.eliminated) return null;"));
});

test("websocket URL supports external config and same-origin Vercel Services", () => {
  assert.ok(socket.includes("process.env.NEXT_PUBLIC_WS_URL?.trim()"));
  assert.ok(socket.includes('process.env.AXIOM_SAME_ORIGIN_WS === "1"'));
  assert.ok(nextConfig.includes("NEXT_PUBLIC_WS_URL:"));
  assert.ok(nextConfig.includes("AXIOM_SAME_ORIGIN_WS: process.env.VERCEL"));
});

test("transition animation consumes moved rooms", () => {
  assert.ok(canvas.includes("apiRef.current?.pulse(props.moved)"));
  assert.ok(canvas.includes("const shiftMarkers: ShiftMarker[] = []"));
});

test("Vercel Services deploy frontend and backend in one project", () => {
  assert.ok(rootPackage.includes('"next": "14.2.15"'));
  assert.ok(vercel.includes('"services"'));
  assert.ok(vercel.includes('"root": "frontend/"'));
  assert.ok(vercel.includes('"framework": "nextjs"'));
  assert.ok(vercel.includes('"root": "backend/"'));
  assert.ok(vercel.includes('"framework": "fastapi"'));
  assert.ok(vercel.includes('"entrypoint": "app.main:app"'));
  assert.ok(vercel.includes('"source": "/backend/:path*"'));
  assert.ok(vercel.includes('"service": "backend"'));
  assert.ok(vercel.includes('"source": "/ws/(.*)"'));
  assert.ok(vercel.includes('"source": "/(.*)"'));
  assert.ok(vercel.includes('"service": "frontend"'));
  assert.ok(frontendVercel.includes('"framework": "nextjs"'));
  assert.ok(frontendVercel.includes('"installCommand": "npm ci"'));
  assert.ok(frontendVercel.includes('"buildCommand": "npm run build"'));
  assert.ok(frontendVercel.includes('"outputDirectory": ".next"'));
  assert.ok(backendProxyRoute.includes("export const maxDuration = 10;"));
});

test("game over summary includes avatar identity", () => {
  assert.ok(game.includes('"avatar_url": p.avatar_url'));
  assert.ok(game.includes('"character_id": p.character_id'));
});

test("predict-shift panel and desktop role intel are removed", () => {
  assert.ok(!client.includes("PredictionPanel"));
  assert.ok(!client.includes("Predict shift"));
  assert.ok(!client.includes('"predict"'));
  const rightColumn = client.slice(
    client.indexOf("{/* right column */}"),
    client.indexOf("{/* mobile command deck */}")
  );
  assert.ok(!rightColumn.includes("Role intel"));
});

test("team notes render in the right column", () => {
  const leftColumn = client.slice(
    client.indexOf("{/* left column */}"),
    client.indexOf("{/* right column */}")
  );
  const rightColumn = client.slice(
    client.indexOf("{/* right column */}"),
    client.indexOf("{/* mobile command deck */}")
  );
  assert.ok(!leftColumn.includes("<NotesPanel"));
  assert.ok(rightColumn.includes("<NotesPanel"));
});

test("room codes are exactly four characters", () => {
  assert.ok(registry.includes("CODE_LENGTH = 4"));
  assert.ok(registry.includes("canonicalize_room_code"));
  assert.ok(main.includes("canonicalize_room_code"));
  assert.ok(lobby.includes("canonicalRoomCode(code)"));
  assert.ok(lobby.includes("maxLength={4}"));
  assert.ok(lobby.includes("/^[A-Z0-9]{4}$/"));
});

test("desktop mouse look uses a sticky locked cursor", () => {
  assert.ok(canvas.includes("requestPointerLock()"));
  assert.ok(canvas.includes('document.addEventListener("pointerlockchange"'));
  assert.ok(canvas.includes("e.movementX"));
  assert.ok(canvas.includes("e.movementY"));
  assert.ok(client.includes("Click to lock cursor"));
});

test("starting points are 25 everywhere", () => {
  assert.ok(fate.includes("START_VITALITY = 25"));
  assert.ok(client.includes("const MAX_POINTS = 25"));
  assert.ok(client.includes("25 points each."));
  assert.ok(lobby.includes("starts with 25 points"));
  assert.ok(landing.includes('["25", "Starting points"]'));
});

test("chat UI is removed while team notes remain", () => {
  assert.ok(!client.includes("bottom chat"));
  assert.ok(!client.includes("Team chat"));
  assert.ok(!socket.includes("setChat"));
  assert.ok(!socket.includes("sendChat"));
  assert.ok(client.includes("<NotesPanel"));
});

test("clicking the arena restores focus after a HUD input", () => {
  assert.ok(canvas.includes("active.blur()"));
  assert.ok(canvas.includes("requestPointerLock()"));
  assert.ok(client.includes("Click to lock cursor"));
});

test("remote players move smoothly from throttled pose events", () => {
  assert.ok(game.includes('"type": "player_move"'));
  assert.ok(game.includes('kind in ("pose", "player_move")'));
  assert.ok(socket.includes("const sendPose"));
  assert.ok(canvas.includes("onPose: (pose: Pose) => void"));
  assert.ok(canvas.includes("userData.remotePlayer"));
});

test("watcher receives the full king schedule and no live king state", () => {
  assert.ok(game.includes('"appearances": appearances'));
  assert.ok(roles.includes('snap.pop("king", None)'));
  assert.ok(game.includes('player.role != "watcher"'));
  assert.ok(client.includes("All five appearances"));
  assert.ok(lobby.includes("full KING OF SPADES schedule"));
});

test("lockdown is escapable by escort and shifts protect locked/exit rooms", () => {
  assert.ok(game.includes("escorted"));
  assert.ok(game.includes("_protected_room_ids"));
  assert.ok(game.includes("self.arena.exit_room().rid"));
  assert.ok(client.includes("lead you out"));
});

test("game over explains the personal loss reason", () => {
  assert.ok(game.includes("death_reason"));
  assert.ok(game.includes('"reason": reason'));
  assert.ok(game.includes("REASON_KING"));
  assert.ok(game.includes("REASON_POINTS_ZERO"));
  assert.ok(game.includes("REASON_TIME_UP"));
  assert.ok(socket.includes("reason_code: m.game_over.reason_code"));
  assert.ok(socket.includes("reason_code: m.reason_code"));
  assert.ok(client.includes("g.gameOver?.reason"));
  assert.ok(client.includes("lossHeadline(g.gameOver?.reason_code)"));
});

test("sealed alerts override instantly and expire in two seconds", () => {
  assert.ok(socket.includes("setSealedAlert(null), 2000"));
  assert.ok(socket.includes("pushSealedAlert("));
  assert.ok(client.includes("animate-toast-sealed"));
  assert.ok(client.includes('key={`sealed-${g.sealedAlert.id}`}'));
});

test("transient alerts last five seconds and only the actor gets lockdown effects", () => {
  assert.ok(socket.includes("setDoorEvent(null), 5000"));
  assert.ok(socket.includes("setCross({"));
  assert.ok(socket.includes("setHazard(null), 5000"));
  assert.ok(socket.includes("setRevive(null), 5000"));
  assert.ok(socket.includes("setExitNotice(null), 5000"));
  assert.ok(socket.includes("if (m.player !== youRef.current)"));
  assert.ok(canvas.includes('event.type === "door_result" && event.locked'));
});

test("desktop movement hint sits at the bottom edge", () => {
  assert.ok(client.includes("bottom-1 left-1/2"));
});

test("guests get a usable name and short room codes survive navigation", () => {
  assert.ok(guest.includes('`Guest${Math.floor(1000 + Math.random() * 9000)}`'));
  assert.ok(lobby.includes("guest.get()"));
  assert.ok(gameLoader.includes("slice(0, 4)"));
  assert.ok(gameLoader.includes('|| "Guest"'));
});

test("guests can select a whitelisted preset PFP", () => {
  assert.ok(guest.includes("getPfp"));
  assert.ok(guest.includes("setPfp"));
  assert.ok(guest.includes("isPfpPresetId"));
  assert.ok(avatarRules.includes("PFP_PRESETS"));
  assert.ok(lobby.includes("Guest profile image"));
  assert.ok(socket.includes("pfp_preset_id"));
  assert.ok(main.includes('frame.get("pfp_preset_id")'));
});

test("room diagnostics expose the backend instance id", () => {
  assert.ok(main.includes("INSTANCE_ID"));
  assert.ok(main.includes('"instance_id": INSTANCE_ID'));
  assert.ok(main.includes("room_join instance=%s"));
  assert.ok(socket.includes('"room_expired"'));
});

test("leave events reconcile the roster immediately", () => {
  assert.ok(game.includes("player_left"));
  assert.ok(game.includes("await self.purge_disconnected()"));
  assert.ok(game.includes("self.final_payload"));
  assert.ok(socket.includes("livePlayers"));
  assert.ok(socket.includes("m.game_over"));
});

test("signed-in profiles load through a deduplicated provider", () => {
  assert.ok(profileProvider.includes("ProfileProvider"));
  assert.ok(profileProvider.includes("inFlightRef"));
  assert.ok(profileProvider.includes('"refreshing"'));
  assert.ok(login.includes("syncProfile("));
  assert.ok(!login.includes("await syncProfile("));
});

test("room join validates the four-character code before navigation", () => {
  assert.ok(lobby.includes("const joinRoom = async () =>"));
  assert.ok(lobby.includes("api.getRoom(target)"));
  assert.ok(lobby.includes("That match has already started."));
  assert.ok(lobby.includes("joinInFlight.current"));
  assert.ok(lobby.includes("retryableRoomLookup("));
  assert.ok(lobby.includes("attempt < 3"));
  assert.ok(socket.includes('"join_timeout"'));
  assert.ok(client.includes("g.connected && g.you"));
});

test("exit room renders a black edge door", () => {
  assert.ok(arena.includes("exit_wall_directions"));
  assert.ok(game.includes('"exit_wall":'));
  assert.ok(canvas.includes("userData.exitDoor"));
  assert.ok(canvas.includes("color: 0x000000"));
});

test("role-mark puzzle remains part of the HUD", () => {
  assert.ok(client.includes("Role mark puzzle"));
  assert.ok(client.includes("Submit role mark"));
});
