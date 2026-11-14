"use client";
import { useEffect, useMemo, useState } from "react";
import GameCanvas from "./GameCanvas";
import WristbandMap from "./WristbandMap";
import { useGameSocket } from "@/lib/useGameSocket";
import type { Direction, Door, DoorColor, PatternType } from "@/lib/types";

const PATTERN_TYPES: PatternType[] = [
  "rotation", "reflection", "translation", "symbol", "sequential", "conditional", "compound",
];
const SIGILS = ["spade", "heart", "diamond", "club"] as const;
const SIGIL_GLYPH: Record<string, string> = {
  spade: "\u2660", heart: "\u2665", diamond: "\u2666", club: "\u2663",
};
const DOOR_HEX: Record<DoorColor, string> = {
  red: "#e23b3b", blue: "#3f7bd9", yellow: "#e8b53a", green: "#3f9f6b",
};
const DOOR_TEXT: Record<DoorColor, string> = {
  red: "text-red", blue: "text-blue", yellow: "text-yellow", green: "text-green",
};
const DOOR_BORDER: Record<DoorColor, string> = {
  red: "border-red/60", blue: "border-blue/60", yellow: "border-yellow/60", green: "border-green/60",
};
const KEY_DIR: Record<string, Direction> = {
  w: "N", arrowup: "N", s: "S", arrowdown: "S",
  a: "W", arrowleft: "W", d: "E", arrowright: "E",
};
const DIRS: Direction[] = ["N", "E", "S", "W"];
const MAX_POINTS = 15;

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`hud rounded-2xl p-4 ${className}`}>{children}</section>;
}

function Stat({ label, value, accent = "text-bone" }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-dim">{label}</span>
      <span className={`mono text-sm ${accent}`}>{value}</span>
    </div>
  );
}

function Points({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, (value / MAX_POINTS) * 100));
  const tone = value <= 3 ? "from-red to-red" : value <= 7 ? "from-yellow to-red" : "from-green to-yellow";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-widest text-dim">Points</span>
        <span className={`mono text-lg ${value <= 3 ? "text-red" : "text-bone"}`}>{value}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/70">
        <div className={`h-full rounded-full bg-gradient-to-r ${tone} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function GameClient({ room, name }: { room: string; name: string }) {
  const g = useGameSocket(room, name);
  const [firstPerson, setFirstPerson] = useState(true);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [secs, setSecs] = useState<number | null>(null);
  const [guessType, setGuessType] = useState<PatternType | "">("");
  const [guessSigils, setGuessSigils] = useState<string[]>([]);
  const { sendChooseDoor, sendWait } = g;

  const me = g.me;
  const myRoom = useMemo(
    () => g.arena?.rooms.find((r) => r.code === me?.room_code) ?? null,
    [g.arena, me?.room_code]
  );
  const exitCode = g.arena
    ? `${String.fromCharCode(65 + g.arena.exit_room[0])}${g.arena.exit_room[1] + 1}`
    : "A5";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (k === " " || k === "spacebar") { e.preventDefault(); sendWait(); return; }
      if (k === "v") { setFirstPerson((v) => !v); return; }
      if (k === "n") { setShowNotes((s) => !s); return; }
      const dir = KEY_DIR[k];
      if (dir) {
        e.preventDefault();
        if (!e.repeat) sendChooseDoor(dir);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sendChooseDoor, sendWait]);

  useEffect(() => {
    if (g.nextAt == null) { setSecs(null); return; }
    const tick = () => setSecs(Math.max(0, (g.nextAt! - performance.now()) / 1000));
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [g.nextAt]);

  const toggleSigil = (s: string) =>
    setGuessSigils((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const difficultyPct = Math.round(((g.nexus.difficulty ?? 0) + 1) / 2 * 100);
  const lockedAllies = g.players.filter(
    (p) => p.locked && !p.eliminated && p.id !== g.you
  );
  const alive = g.players.filter((p) => !p.eliminated);
  const futureEntries = Object.entries(g.futures);
  const diceEntries = Object.entries(g.dice);
  const isLobby = g.status === "lobby";
  const isOver = g.status === "won" || g.status === "over";

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-coal text-bone">
      <GameCanvas
        arena={g.arena}
        you={me}
        players={g.players}
        youId={g.you}
        role={g.role}
        dice={g.dice}
        futures={g.futures}
        exitUnsealed={g.exitUnsealed}
        transitionId={g.transition.id}
        moved={g.transition.moved}
        firstPerson={firstPerson}
        onChooseDoor={sendChooseDoor}
      />

      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between p-4">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <span className="mono rounded-xl border border-edge bg-ink/85 px-3 py-2 text-sm tracking-[0.25em] backdrop-blur">
            {room}
          </span>
          <span className="rounded-xl border border-edge bg-ink/85 px-3 py-2 text-xs text-dim backdrop-blur">
            Stage <span className="mono text-yellow">{g.stage}</span>/{g.maxStage} · {g.stageName}
          </span>
          <span className="rounded-xl border border-edge bg-ink/85 px-3 py-2 text-xs text-dim backdrop-blur">
            Round <span className="mono text-bone">{g.round}</span>/{g.maxRounds}
          </span>
          <span className="rounded-xl border border-edge bg-ink/85 px-3 py-2 text-xs text-dim backdrop-blur">
            Room <span className="mono text-bone">{me?.room_code ?? "--"}</span>
          </span>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="rounded-xl border border-edge bg-ink/85 px-4 py-2 text-center backdrop-blur">
            <div className="text-[10px] uppercase tracking-widest text-dim">Next shift</div>
            <div className={`mono text-lg tabular-nums ${secs != null && secs < 4 ? "text-red" : "text-bone"}`}>
              {secs == null ? "--" : secs.toFixed(1) + "s"}
            </div>
          </div>
          <button
            onClick={() => setFirstPerson((v) => !v)}
            className="rounded-xl border border-edge bg-ink/85 px-3 py-2 text-xs text-dim backdrop-blur transition hover:text-bone"
            title="Toggle camera (V)"
          >
            {firstPerson ? "First person" : "Third person"}
          </button>
          <button
            onClick={() => setShowNotes((s) => !s)}
            className="rounded-xl border border-edge bg-ink/85 px-3 py-2 text-xs text-dim backdrop-blur transition hover:text-bone"
          >
            {showNotes ? "Hide notes" : "Notes"}
          </button>
        </div>
      </div>

      {/* dealer announcement */}
      {g.pa && (
        <div className="pointer-events-none absolute left-1/2 top-[68px] z-10 w-[min(680px,88vw)] -translate-x-1/2 text-center">
          <p className="mono inline-block rounded-full border border-yellow/30 bg-ink/80 px-4 py-1 text-[11px] tracking-[0.18em] text-yellow/90 backdrop-blur">
            {g.pa}
          </p>
        </div>
      )}

      {/* left column */}
      <div className="absolute left-4 top-20 z-20 max-h-[calc(100vh-6rem)] w-64 space-y-3 overflow-y-auto pb-4 scroll-thin">
        <Panel>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-dim">Your role</span>
            <span className="mono text-sm text-blue">{g.roleLabel}</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-dim">{g.roleHint}</p>
          <div className="mt-3">
            <Points value={me?.points ?? 0} />
          </div>
          <div className="mt-3 space-y-1.5">
            <Stat label="Streak" value={g.players.find((p) => p.id === g.you)?.streak ?? 0} accent="text-yellow" />
            <Stat
              label="Correct calls"
              value={`${g.players.find((p) => p.id === g.you)?.correct ?? 0}/${g.players.find((p) => p.id === g.you)?.predictions ?? 0}`}
              accent="text-blue"
            />
            <Stat label="Hidden rules" value={g.ruleCount} accent="text-green" />
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-dim">Wristband</span>
            <span className="mono text-[10px] text-dim">A1–E5</span>
          </div>
          <WristbandMap arena={g.arena} youCode={me?.room_code ?? null} className="mt-2" />
          <p className="mt-2 text-[10px] leading-relaxed text-dim">
            Edge bars are door colours; dim bars are sealed. The grid shifts every round.
          </p>
        </Panel>

        <Panel>
          <span className="text-xs uppercase tracking-widest text-dim">Doors</span>
          <div className="mt-2 grid grid-cols-3 grid-rows-3 gap-1">
            <div />
            <DoorButton dir="N" door={me?.doors?.N} onClick={() => sendChooseDoor("N")} />
            <div />
            <DoorButton dir="W" door={me?.doors?.W} onClick={() => sendChooseDoor("W")} />
            <button
              onClick={sendWait}
              className="rounded-lg border border-edge bg-ink/50 py-2 text-[10px] text-dim transition hover:border-yellow hover:text-yellow"
              title="Wait (−1 point)"
            >
              WAIT
            </button>
            <DoorButton dir="E" door={me?.doors?.E} onClick={() => sendChooseDoor("E")} />
            <div />
            <DoorButton dir="S" door={me?.doors?.S} onClick={() => sendChooseDoor("S")} />
            <div />
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-dim">
            WASD / arrows choose a door · Space waits · V camera. Crossing costs 1 point; a 0-capacity door is a lockdown.
          </p>
        </Panel>

        <Panel>
          <span className="text-xs uppercase tracking-widest text-dim">Team</span>
          <ul className="mt-2 space-y-2">
            {g.players.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-sm">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: p.color }} />
                <span className={p.id === g.you ? "font-semibold" : ""}>{p.name}</span>
                <span className="mono text-[10px] text-dim">{p.room_code ?? "--"}</span>
                <span className="mono ml-auto text-xs text-dim">{p.points}</span>
                {p.locked && <span className="text-[10px] text-red">locked</span>}
                {p.eliminated && <span className="text-[10px] text-red">out</span>}
                {p.escaped && <span className="text-[10px] text-green">out✓</span>}
                {!p.connected && <span className="text-[10px] text-dim">off</span>}
              </li>
            ))}
          </ul>
        </Panel>

        {lockedAllies.length > 0 && (
          <Panel className="border-red/60">
            <span className="text-xs uppercase tracking-widest text-red">Free a teammate</span>
            {lockedAllies.map((p) => (
              <button
                key={p.id}
                onClick={() => g.sendUnlock(p.id)}
                className="mt-2 w-full rounded-lg border border-red/60 py-1.5 text-xs text-red transition hover:bg-red/10"
              >
                Scan {p.name} ({p.room_code}) · 2 helpers, −1 each
              </button>
            ))}
          </Panel>
        )}

        {showNotes && (
          <Panel>
            <span className="text-xs uppercase tracking-widest text-dim">Team notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Yellow door in C3 is sealed. Oracle, read the north wall…"
              className="scroll-thin mt-2 h-24 w-full resize-none rounded-lg border border-edge bg-ink/60 p-2 text-xs outline-none focus:border-blue"
            />
            <button
              onClick={() => { g.sendClue(g.role, notes); setNotes(""); }}
              disabled={!notes.trim()}
              className="mt-2 w-full rounded-lg border border-edge py-1.5 text-xs text-dim transition hover:border-blue hover:text-bone disabled:opacity-40"
            >
              Share with team
            </button>
            <div className="scroll-thin mt-2 max-h-24 space-y-1 overflow-y-auto">
              {g.teamNotes.map((n, i) => (
                <p key={i} className="text-xs text-dim">
                  <span className="text-bone">{n.from}</span> · {n.text}
                </p>
              ))}
            </div>
          </Panel>
        )}
      </div>

      {/* right column */}
      <div className="absolute right-4 top-20 z-20 max-h-[calc(100vh-6rem)] w-72 space-y-3 overflow-y-auto pb-4 scroll-thin">
        <Panel>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-dim">The Dealer</span>
            <span className="h-2 w-2 animate-pulse-glow rounded-full bg-yellow" />
          </div>
          <p className="mt-2 text-xs italic leading-relaxed text-bone">“{g.pa}”</p>
          <div className="mt-3 space-y-1.5">
            <Stat label="Team skill" value={`${Math.round((g.nexus.team_skill ?? 0) * 100)}%`} accent="text-blue" />
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-dim">Pressure</span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-edge/50">
                <div className="h-full rounded-full bg-gradient-to-r from-green via-yellow to-red" style={{ width: `${difficultyPct}%` }} />
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {g.nexus.players.map((p) => (
              <span
                key={p.pid}
                title={`pattern ${Math.round((p.attrs?.pattern ?? 0) * 100)}% · cooperation ${Math.round((p.attrs?.cooperation ?? 0) * 100)}%`}
                className="rounded-full border border-edge px-2 py-0.5 text-[10px] text-dim"
              >
                {p.name || p.pid} · {p.style}
              </span>
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-dim">
              {g.role === "timekeeper" ? "Fate d10" : "Possible futures"}
            </span>
            <span className="mono text-[10px] text-dim">{g.role}</span>
          </div>

          {g.role === "timekeeper" ? (
            diceEntries.length === 0 ? (
              <p className="mt-2 text-[11px] text-dim">No dice rolled yet.</p>
            ) : (
              <div className="scroll-thin mt-2 max-h-44 space-y-1 overflow-y-auto">
                {diceEntries.map(([code, d]) => (
                  <div key={code} className="rounded-lg bg-ink/40 px-2 py-1 text-[11px]">
                    <span className="mono text-dim">{code}</span>
                    <span className="ml-2">
                      {DIRS.map((dir) => {
                        const dd = d.doors?.[dir];
                        if (!dd) return null;
                        return (
                          <span key={dir} className="mono ml-1" style={{ color: DOOR_HEX[dd.color] }}>
                            {dir}{dd.roll}
                          </span>
                        );
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )
          ) : g.role === "archivist" ? (
            <div className="mt-2">
              <p className="text-[11px] leading-relaxed text-dim">
                The previous grid is ghosted below. Compare it with the living walls.
              </p>
              <WristbandMap arena={g.prevArena} youCode={null} className="mt-2 opacity-80" />
            </div>
          ) : futureEntries.length === 0 ? (
            <p className="mt-2 text-[11px] text-dim">No visions this round.</p>
          ) : (
            <div className="scroll-thin mt-2 max-h-44 space-y-1 overflow-y-auto">
              {futureEntries.map(([code, fr]) => (
                <div key={code} className="flex items-center gap-2 rounded-lg bg-ink/40 px-2 py-1 text-[11px]">
                  <span className="mono w-7 shrink-0 text-dim">{code}</span>
                  <span className="flex flex-wrap gap-1">
                    {DIRS.map((dir) => {
                      const d = fr.doors?.[dir];
                      if (!d) return null;
                      const label = d.future ?? (d.capacity != null ? String(d.capacity) : "?");
                      return (
                        <span key={dir} className={`mono ${futureTone(d.future)}`} style={d.color ? { color: DOOR_HEX[d.color] } : undefined}>
                          {dir}:{label}
                        </span>
                      );
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel>
          <span className="text-xs uppercase tracking-widest text-dim">Predict the next shift</span>
          <p className="mt-1 text-[11px] text-dim">Correct calls delay the shift. Wrong ones hurry it.</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {PATTERN_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setGuessType((cur) => (cur === t ? "" : t))}
                className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                  guessType === t ? "border-blue bg-blue/15 text-blue" : "border-edge text-dim hover:text-bone"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1">
            {SIGILS.map((s) => (
              <button
                key={s}
                onClick={() => toggleSigil(s)}
                className={`rounded-lg border py-1 text-sm transition ${
                  guessSigils.includes(s) ? "border-yellow text-yellow" : "border-edge text-dim hover:text-bone"
                }`}
                title={s}
              >
                {SIGIL_GLYPH[s]}
              </button>
            ))}
          </div>
          <button
            onClick={() =>
              g.sendPredict(guessType || undefined, guessSigils.length ? guessSigils : undefined)
            }
            disabled={!guessType && guessSigils.length === 0}
            className="mt-3 w-full rounded-lg bg-bone py-2 text-sm font-semibold text-coal transition hover:brightness-95 disabled:opacity-40"
          >
            Submit prediction
          </button>
          {g.prediction && (
            <p className={`mt-2 text-xs ${g.prediction.correct ? "text-green" : "text-red"}`}>
              {g.prediction.correct ? "Correct" : "Missed"} · {Math.round(g.prediction.score * 100)}% match
            </p>
          )}
        </Panel>

        {g.puzzle && (
          <Panel className="border-yellow/50">
            <span className="text-xs uppercase tracking-widest text-yellow">Cooperative cipher</span>
            <p className="mt-2 text-sm">{g.puzzle.question}</p>
            <ul className="mt-2 space-y-1">
              {g.puzzle.clues.map((c, i) => (
                <li key={i} className="rounded-lg bg-ink/50 p-2 text-[11px] text-dim">
                  Your clue: {c}
                </li>
              ))}
            </ul>
            <div className="scroll-thin mt-2 grid max-h-40 grid-cols-5 gap-1 overflow-y-auto">
              {g.puzzle.options.map((o, i) => (
                <button
                  key={o}
                  onClick={() => g.sendPuzzle(i)}
                  className="mono rounded-lg border border-edge py-1.5 text-[10px] transition hover:border-yellow hover:text-yellow"
                >
                  {o}
                </button>
              ))}
            </div>
            {g.puzzleResult != null && (
              <p className={`mt-2 text-xs ${g.puzzleResult ? "text-green" : "text-red"}`}>
                {g.puzzleResult ? "Accepted — the final door is open" : "The cipher rejects that code"}
              </p>
            )}
          </Panel>
        )}
      </div>

      {/* bottom chat */}
      <div className="absolute bottom-4 left-1/2 z-20 w-[min(560px,90vw)] -translate-x-1/2">
        <div className="hud rounded-2xl p-3">
          <div className="scroll-thin mb-2 max-h-24 space-y-1 overflow-y-auto">
            {g.chat.map((c, i) => (
              <p key={i} className="text-xs">
                <span style={{ color: c.color }} className="font-medium">{c.from}</span>
                <span className="text-dim"> · {c.text}</span>
              </p>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && chatInput.trim()) { g.sendChat(chatInput); setChatInput(""); }
              }}
              placeholder="Message your team…"
              className="flex-1 rounded-lg border border-edge bg-ink/60 px-3 py-2 text-sm outline-none focus:border-blue"
            />
            <button
              onClick={() => { if (chatInput.trim()) { g.sendChat(chatInput); setChatInput(""); } }}
              className="rounded-lg border border-edge px-4 text-sm text-dim transition hover:border-blue hover:text-bone"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* event toasts */}
      <div className="pointer-events-none absolute bottom-32 left-1/2 z-20 flex w-[min(520px,90vw)] -translate-x-1/2 flex-col items-center gap-2">
        {g.doorEvent?.locked && (
          <div className="rounded-xl border border-red/60 bg-ink/90 px-4 py-2 text-xs text-red backdrop-blur">
            Lockdown. Two teammates must scan your wristband free.
          </div>
        )}
        {g.doorEvent && g.doorEvent.accepted && (
          <div className="rounded-xl border border-green/60 bg-ink/90 px-4 py-2 text-xs text-green backdrop-blur">
            Crossed the {g.doorEvent.color ?? g.doorEvent.door} door
            {g.doorEvent.target_code ? ` into ${g.doorEvent.target_code}` : ""}
            {g.doorEvent.remaining != null ? ` · ${g.doorEvent.remaining} crossings left` : ""}
          </div>
        )}
        {g.doorEvent && !g.doorEvent.accepted && !g.doorEvent.locked && g.doorEvent.message && (
          <div className="rounded-xl border border-edge bg-ink/90 px-4 py-2 text-xs text-dim backdrop-blur">
            {g.doorEvent.message}
          </div>
        )}
        {g.hazard && (
          <div className="rounded-xl border border-red/60 bg-ink/90 px-4 py-2 text-xs text-red backdrop-blur">
            Sanction room {g.hazard.room_code} · −{g.hazard.penalty} points
          </div>
        )}
        {g.revive && (
          <div className="rounded-xl border border-green/60 bg-ink/90 px-4 py-2 text-xs text-green backdrop-blur">
            A locked player was scanned free.
          </div>
        )}
        {g.exitNotice && (
          <div className="rounded-xl border border-yellow/60 bg-ink/90 px-4 py-2 text-xs text-yellow backdrop-blur">
            {g.exitNotice}
          </div>
        )}
      </div>

      {/* status overlays */}
      {me?.locked && g.status === "running" && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 text-center">
          <p className="inline-block rounded-2xl border border-red/60 bg-ink/90 px-6 py-3 text-sm text-red backdrop-blur">
            You are locked in. Two teammates in or beside this room must scan you free.
          </p>
        </div>
      )}

      {isLobby && !g.error && g.connected && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-coal/80 backdrop-blur-sm">
          <div className="hud w-[min(460px,92vw)] rounded-3xl p-8 text-center animate-rise">
            <p className="mono text-[10px] uppercase tracking-[0.3em] text-yellow">The Last Room</p>
            <h2 className="mt-2 text-2xl font-semibold">Assembling the team</h2>
            <p className="mt-2 text-sm text-dim">
              {g.players.filter((p) => p.connected).length} of {g.minPlayers} needed · press Ready
            </p>
            <ul className="mt-4 space-y-2 text-left">
              {g.players.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
                  <span>{p.name}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-dim">{p.role}</span>
                  <span className={`text-xs ${p.ready ? "text-yellow" : "text-dim"}`}>
                    {p.ready ? "ready" : "waiting"}
                  </span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => g.sendReady(!(g.players.find((p) => p.id === g.you)?.ready ?? false))}
              className={`mt-6 w-full rounded-xl py-3 font-semibold transition ${
                g.players.find((p) => p.id === g.you)?.ready
                  ? "border border-edge text-dim"
                  : "bg-bone text-coal hover:brightness-95"
              }`}
            >
              {g.players.find((p) => p.id === g.you)?.ready ? "Cancel ready" : "Ready up"}
            </button>
            <p className="mt-4 text-[11px] leading-relaxed text-dim">
              Spawn in C3. Reach A5 with every living player and unseal the final door. 15 points each.
            </p>
          </div>
        </div>
      )}

      {isOver && !g.error && g.connected && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-coal/80 backdrop-blur-sm">
          <div className="hud w-[min(460px,92vw)] rounded-3xl p-8 text-center animate-rise">
            <p className="mono text-[10px] uppercase tracking-[0.3em] text-yellow">
              {g.status === "won" ? "Escape" : "Game over"}
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              {g.status === "won" ? "The final door is open." : "The Last Room claims you."}
            </h2>
            <p className="mt-2 text-sm text-dim">
              {g.gameOver?.summary
                ? `${g.gameOver.summary.rounds} rounds · ${g.gameOver.summary.eliminated} eliminated · team skill ${Math.round((g.gameOver.summary.team_skill ?? 0) * 100)}%`
                : ""}
            </p>
            <div className="mt-4 space-y-1 text-left">
              {(g.gameOver?.summary?.players ?? []).map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span>{p.name}</span>
                  <span className="mono text-dim">
                    {p.escaped ? "escaped" : p.eliminated ? "eliminated" : "left behind"} · {p.points} pts
                  </span>
                </div>
              ))}
            </div>
            <a href="/profile" className="mt-6 inline-block rounded-xl bg-bone px-6 py-2 font-medium text-coal">
              View profile
            </a>
          </div>
        </div>
      )}

      {me?.eliminated && g.status === "running" && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-coal/45">
          <p className="rounded-2xl border border-red/60 bg-ink/90 px-6 py-3 text-sm text-red backdrop-blur">
            Points spent. You are eliminated — the team plays on.
          </p>
        </div>
      )}

      {(g.error || !g.connected) && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-coal/90">
          <div className="hud rounded-2xl px-6 py-4 text-center">
            {g.error ? <p className="text-red">{g.error}</p> : <p className="text-dim">Connecting to the arena…</p>}
          </div>
        </div>
      )}

      <div className="mono pointer-events-none absolute bottom-2 right-3 z-10 text-[10px] text-dim">
        {alive.length}/{g.players.length} alive · exit {exitCode} {g.exitUnsealed ? "open" : "sealed"}
      </div>
    </main>
  );
}

function futureTone(future?: string) {
  if (future === "exit") return "text-yellow";
  if (future === "sanction") return "text-red";
  if (future === "open") return "text-green";
  return "text-dim";
}

function DoorButton({
  dir, door, onClick,
}: {
  dir: Direction;
  door?: Door & { open?: boolean };
  onClick: () => void;
}) {
  const open = !!door?.open && !door?.sealed;
  const color: DoorColor = door?.color ?? "red";
  return (
    <button
      onClick={onClick}
      disabled={!open}
      className={`relative flex flex-col items-center justify-center rounded-lg border py-2 text-[11px] transition ${
        open ? `${DOOR_BORDER[color]} ${DOOR_TEXT[color]} hover:brightness-125` : "border-edge text-dim opacity-40"
      }`}
      title={
        open
          ? `Cross ${dir} (${color})${door?.capacity != null ? ` · ${door.capacity} crossings left` : ""}`
          : door?.sealed ? "Sealed door" : "No doorway"
      }
    >
      <span className="mono text-[10px] leading-none">{dir}</span>
      <span className="mt-1 h-1.5 w-6 rounded-full" style={{ background: DOOR_HEX[color], opacity: open ? 1 : 0.3 }} />
      <span className="mono mt-1 text-[9px] leading-none text-dim">
        {door?.sealed ? "✕" : door?.capacity != null ? door.capacity : "—"}
      </span>
    </button>
  );
}
