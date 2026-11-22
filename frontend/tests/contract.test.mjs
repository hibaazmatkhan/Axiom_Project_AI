import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const client = read("../components/GameClient.tsx");
const canvas = read("../components/GameCanvas.tsx");
const socket = read("../lib/useGameSocket.ts");
const nextConfig = read("../next.config.mjs");
const vercel = read("../../vercel.json");
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

test("websocket URL supports public runtime configuration", () => {
  assert.ok(socket.includes("process.env.NEXT_PUBLIC_WS_URL?.trim()"));
  assert.ok(nextConfig.includes("NEXT_PUBLIC_WS_URL:"));
});

test("transition animation consumes moved rooms", () => {
  assert.ok(canvas.includes("apiRef.current?.pulse(props.moved)"));
  assert.ok(canvas.includes("const shiftMarkers: ShiftMarker[] = []"));
});

test("Vercel config hosts only the Next.js frontend", () => {
  assert.ok(vercel.includes('"outputDirectory": "frontend/.next"'));
  assert.ok(!vercel.includes('"services"'));
  assert.ok(vercel.includes('"maxDuration": 10'));
});

test("game over summary includes avatar identity", () => {
  assert.ok(game.includes('"avatar_url": p.avatar_url'));
  assert.ok(game.includes('"character_id": p.character_id'));
});
