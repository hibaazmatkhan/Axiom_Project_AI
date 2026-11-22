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
