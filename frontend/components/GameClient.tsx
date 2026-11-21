"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import GameCanvas from "./GameCanvas";
import WristbandMap from "./WristbandMap";
import { SuitMark } from "./Brand";
import Avatar from "./Avatar";
import { useGameSocket } from "@/lib/useGameSocket";
import type { DoorColor, PatternType } from "@/lib/types";

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
const DIRS = ["N", "E", "S", "W"] as const;
const MAX_POINTS = 15;

function formatClock(value: number) {
  const total = Math.max(0, Math.ceil(value));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`broadcast-panel panel-cut p-4 ${className}`}>{children}</section>;
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
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-void/70">
        <div className={`h-full rounded-full bg-gradient-to-r ${tone} transition-all duration-500 ease-out`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function GameClient({ room, name }: { room: string; name: string }) {
  const g = useGameSocket(room, name);
  const [chatInput, setChatInput] = useState("");
  const [secs, setSecs] = useState<number | null>(null);
  const [matchSecs, setMatchSecs] = useState<number | null>(null);
  const [guessType, setGuessType] = useState<PatternType | "">("");
  const [guessSigils, setGuessSigils] = useState<string[]>([]);
  const [mobilePanel, setMobilePanel] = useState<"none" | "map" | "chat" | "puzzle">("none");
  const [teamOpen, setTeamOpen] = useState(false);
  const [puzzleMark, setPuzzleMark] = useState("");
  const teamRef = useRef<HTMLDivElement>(null);
  const { sendOpenDoor, sendCrossDoor, sendWait } = g;

  const me = g.me;
  const myRoom = useMemo(
    () => g.arena?.rooms.find((r) => r.code === me?.room_code) ?? null,
    [g.arena, me?.room_code]
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (e.metaKey || e.ctrlKey || e.altKey || target?.isContentEditable) return;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      if (k === " " || k === "spacebar") { e.preventDefault(); sendWait(); return; }
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        e.preventDefault();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sendWait]);

  useEffect(() => {
    const tick = () => {
      setSecs(g.nextAt == null ? null : Math.max(0, (g.nextAt - performance.now()) / 1000));
      setMatchSecs(g.matchAt == null ? null : Math.max(0, (g.matchAt - performance.now()) / 1000));
    };
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [g.nextAt, g.matchAt]);

  const toggleSigil = (s: string) =>
    setGuessSigils((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  useEffect(() => {
    setPuzzleMark("");
  }, [g.puzzle?.you?.role, g.puzzle?.you?.domain.join("|")]);

  useEffect(() => {
    if (!teamOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!teamRef.current?.contains(event.target as Node)) setTeamOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTeamOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [teamOpen]);

  const difficultyPct = Math.round(((g.nexus.difficulty ?? 0) + 1) / 2 * 100);
  const lockedAllies = g.players.filter(
    (p) => p.locked && !p.eliminated && p.id !== g.you
  );
  const alive = g.players.filter((p) => !p.eliminated);
  const teamRoster = useMemo(() => [...g.players].sort((a, b) => a.slot - b.slot), [g.players]);
  const futureEntries = Object.entries(g.futures);
  const diceEntries = Object.entries(g.dice);
  const isLobby = g.status === "lobby";
  const isOver = g.status === "won" || g.status === "over";

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-void text-bone">
      <GameCanvas
        arena={g.arena}
        you={me}
        players={g.players}
        youId={g.you}
        transitionId={g.transition.id}
        moved={g.transition.moved}
        cross={g.cross}
        doorEvent={g.doorEvent}
        onOpenDoor={sendOpenDoor}
        onCrossDoor={sendCrossDoor}
      />

      {g.status === "running" && (
        <div className="pointer-events-none absolute bottom-28 left-1/2 z-10 -translate-x-1/2 xl:bottom-24">
          <p className="mono rounded-full border border-bone/15 bg-void/70 px-3 py-1 text-[9px] uppercase tracking-[0.16em] text-dim backdrop-blur">
            Click into arena to look · click a door to open · WASD to walk in · Esc stops view
          </p>
        </div>
      )}

      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-3 p-3 sm:p-4">
        <div className="pointer-events-auto flex min-w-0 flex-wrap items-center gap-2">
          <span className="mono flex items-center gap-2 border border-red/40 bg-void/85 px-2.5 py-2 text-[9px] uppercase tracking-[0.2em] text-red backdrop-blur">
            <span className="signal-dot" />
            Live
          </span>
          <span className="border border-edge bg-void/85 px-2.5 py-2 text-[10px] uppercase tracking-[0.12em] text-dim backdrop-blur">
            R<span className="mono ml-1 text-bone">{g.round}</span>/{g.maxRounds}
          </span>
          <span className="border border-edge bg-void/85 px-2.5 py-2 text-[10px] uppercase tracking-[0.12em] text-dim backdrop-blur">
            Room <span className="mono ml-1 text-bone">{me?.room_code ?? "--"}</span>
          </span>
          <span className="border border-edge bg-void/85 px-2.5 py-2 text-[10px] uppercase tracking-[0.12em] text-dim backdrop-blur">
            SANCTIONS <span className="mono ml-1 text-bone">{g.sanctionFound}</span>
            <span className="mx-1 text-ash">/</span>
            <span className="mono text-bone">{g.sanctionTotal}</span>
          </span>
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          <div ref={teamRef} className="relative">
            <button
              type="button"
              onClick={() => setTeamOpen((open) => !open)}
              aria-expanded={teamOpen}
              aria-label="Toggle team roster"
              className="flex items-center gap-2 border border-edge bg-void/85 px-2.5 py-2 text-[10px] uppercase tracking-[0.14em] text-dim backdrop-blur transition hover:border-gold/50 hover:text-bone"
            >
              <span>Team</span>
              <span className="mono text-[9px] text-gold">{room}</span>
              <span className={`text-[8px] transition ${teamOpen ? "rotate-180 text-bone" : ""}`}>▼</span>
            </button>
            {teamOpen && (
              <div className="absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-bone/15 bg-void/95 p-2 shadow-hud backdrop-blur-xl sm:w-64">
                <div className="mono px-1 pb-2 text-[9px] uppercase tracking-[0.2em] text-dim">
                  Room <span className="text-gold">{room}</span>
                </div>
                <ul className="scroll-thin max-h-[45vh] space-y-1 overflow-y-auto">
                  {teamRoster.map((player) => (
                    <li key={player.id} className="flex min-w-0 items-center gap-2 px-1 py-1 text-sm">
                      <Avatar
                        src={player.avatar_url}
                        name={player.name}
                        color={player.color}
                        size={24}
                        showSuit={false}
                      />
                      <span className={`truncate ${player.id === g.you ? "font-semibold text-bone" : ""}`}>
                        {player.name}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {g.status === "running" && (
            <div className="border border-gold/40 bg-void/85 px-3 py-1.5 text-center backdrop-blur sm:px-4 sm:py-2">
              <div className="mono text-[8px] uppercase tracking-[0.18em] text-dim sm:text-[10px]">
                Time left
              </div>
              <div className={`mono text-base tabular-nums sm:text-lg ${matchSecs != null && matchSecs < 30 ? "text-red" : "text-gold"}`}>
                {matchSecs == null ? "--" : formatClock(matchSecs)}
              </div>
            </div>
          )}
          <div className="border border-edge bg-void/85 px-3 py-1.5 text-center backdrop-blur sm:px-4 sm:py-2">
            <div className="mono text-[8px] uppercase tracking-[0.18em] text-dim sm:text-[10px]">
              Next shift
            </div>
            <div className={`mono text-base tabular-nums sm:text-lg ${secs != null && secs < 4 ? "text-red" : "text-bone"}`}>
              {secs == null ? "--" : secs.toFixed(1) + "s"}
            </div>
          </div>
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
      <div className="absolute left-4 top-20 z-20 hidden max-h-[calc(100vh-6rem)] w-64 space-y-3 overflow-y-auto pb-4 scroll-thin xl:block">
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
          <WristbandMap arena={g.arena} youCode={me?.room_code ?? null} exitCode={me?.exit_code ?? null} className="mt-2" />
          <p className="mt-2 text-[10px] leading-relaxed text-dim">
            Edge bars are door colours; dim bars are blocked walls. D10 seals stay hidden.
          </p>
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
                Scan {p.name} free · 2 helpers, −1 each
              </button>
            ))}
          </Panel>
        )}

      </div>

      {/* right column */}
      <div className="absolute right-4 top-20 z-20 hidden max-h-[calc(100vh-6rem)] w-72 space-y-3 overflow-y-auto pb-4 scroll-thin xl:block">
        <Panel>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-dim">The Dealer</span>
            <span className="h-2 w-2 animate-pulse-glow rounded-full bg-yellow" />
          </div>
          <p className="mt-2 text-xs italic leading-relaxed text-bone">“{g.dealerClue?.text ?? g.pa}”</p>
          {g.dealerNudge && (
            <p className="mt-2 rounded-lg border border-yellow/40 bg-yellow/10 px-2 py-1 text-[11px] text-yellow">
              Whisper · {g.dealerNudge.text}
              {g.dealerNudge.puzzle ? ` ${g.dealerNudge.puzzle}` : ""}
            </p>
          )}
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
          <span className="text-xs uppercase tracking-widest text-dim">Movement</span>
          <p className="mt-2 text-[11px] leading-relaxed text-dim">
            Move the cursor to look around, click a door or press E to pay 1 point and hold it open for 10s. Walk into the open doorway to enter the next room; any living teammate can follow for free.
          </p>
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
                            {dir}
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
                      const label = d.future ?? "?";
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

        <Panel>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-dim">Role mark puzzle</span>
            <span className="mono text-[10px] text-dim">
              {g.puzzle?.public?.solved ? "solved" : `${g.puzzle?.public?.attempts ?? 0} tries`}
            </span>
          </div>
          {g.puzzle?.you ? (
            <>
              <p className="mt-1 text-[11px] leading-relaxed text-dim">
                Set only your role's mark. Share the clues; every role must contribute.
              </p>
              <div className="mt-2 space-y-1">
                {g.puzzle.you.clues.map((clue, index) => (
                  <p key={index} className="text-[11px] text-bone">· {clue}</p>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {g.puzzle.you.domain.map((value) => (
                  <button
                    key={value}
                    onClick={() => setPuzzleMark(value)}
                    className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                      puzzleMark === value ? "border-yellow bg-yellow/15 text-yellow" : "border-edge text-dim hover:text-bone"
                    }`}
                  >
                    {SIGIL_GLYPH[value] ?? value}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  if (g.puzzle?.you && puzzleMark) g.sendPuzzleMark(g.puzzle.you.role, puzzleMark);
                }}
                disabled={!puzzleMark}
                className="mt-3 w-full rounded-lg bg-bone py-2 text-sm font-semibold text-coal transition hover:brightness-95 disabled:opacity-40"
              >
                Submit role mark
              </button>
            </>
          ) : (
            <p className="mt-2 text-[11px] text-dim">No role clue assigned.</p>
          )}
          {g.puzzleResult && (
            <p className={`mt-2 text-xs ${g.puzzleResult.correct ? "text-green" : "text-red"}`}>
              {g.puzzleResult.code === "unavailable" || g.puzzleResult.code === "invalid_mark"
                ? g.puzzleResult.code.replace("_", " ")
                : g.puzzleResult.correct
                  ? "Marks aligned. The team is rewarded."
                  : `${g.puzzleResult.marks}/4 marks set · ${g.puzzleResult.attempts} tries`}
            </p>
          )}
        </Panel>
      </div>

      {/* bottom chat */}
      <div className="absolute bottom-4 left-1/2 z-20 hidden w-[min(560px,90vw)] -translate-x-1/2 xl:block">
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

      {/* mobile command deck */}
      <div className="absolute inset-x-0 bottom-0 z-20 xl:hidden">
        {mobilePanel !== "none" && (
          <div className="scroll-thin mx-3 mb-2 max-h-[42vh] overflow-y-auto rounded-xl border border-bone/15 bg-void/95 p-3 shadow-hud backdrop-blur-xl">
            {mobilePanel === "map" && (
              <div>
                <div className="flex items-center justify-between">
                  <span className="mono text-[10px] uppercase tracking-[0.2em] text-gold">
                    Wristband
                  </span>
                  <span className="mono text-[9px] text-dim">A1–E5</span>
                </div>
                <WristbandMap arena={g.arena} wristband={g.wristband} youCode={me?.room_code ?? null} exitCode={me?.exit_code ?? null} className="mt-2" />
                <p className="mt-2 text-[10px] leading-relaxed text-dim">
                  Edge bars are door colours. Dim bars are sealed. The grid shifts every round.
                </p>
              </div>
            )}

            {mobilePanel === "chat" && (
              <div>
                <span className="mono text-[10px] uppercase tracking-[0.2em] text-gold">Team chat</span>
                <div className="scroll-thin mt-2 max-h-36 space-y-1 overflow-y-auto">
                  {g.chat.length === 0 && <p className="text-xs text-dim">No messages yet.</p>}
                  {g.chat.map((line, index) => (
                    <p key={index} className="text-xs">
                      <span style={{ color: line.color }} className="font-medium">
                        {line.from}
                      </span>
                      <span className="text-dim"> · {line.text}</span>
                    </p>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && chatInput.trim()) {
                        g.sendChat(chatInput);
                        setChatInput("");
                      }
                    }}
                    placeholder="Message your team…"
                    className="min-w-0 flex-1 rounded-lg border border-edge bg-ink/60 px-3 py-2 text-sm outline-none focus:border-blue"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (chatInput.trim()) {
                        g.sendChat(chatInput);
                        setChatInput("");
                      }
                    }}
                    className="rounded-lg border border-edge px-3 text-xs text-dim transition hover:border-blue hover:text-bone"
                  >
                    Send
                  </button>
                </div>
              </div>
            )}

            {mobilePanel === "puzzle" && (
              <div>
                <span className="mono text-[10px] uppercase tracking-[0.2em] text-gold">Role marks</span>
                {g.puzzle?.you ? (
                  <>
                    <div className="mt-2 space-y-1">
                      {g.puzzle.you.clues.map((clue, index) => (
                        <p key={index} className="text-[11px] text-bone">· {clue}</p>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {g.puzzle.you.domain.map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setPuzzleMark(value)}
                          className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                            puzzleMark === value ? "border-yellow bg-yellow/15 text-yellow" : "border-edge text-dim"
                          }`}
                        >
                          {SIGIL_GLYPH[value] ?? value}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (g.puzzle?.you && puzzleMark) g.sendPuzzleMark(g.puzzle.you.role, puzzleMark);
                      }}
                      disabled={!puzzleMark}
                      className="mt-2 w-full rounded-lg bg-bone py-2 text-xs font-semibold text-coal disabled:opacity-40"
                    >
                      Submit role mark
                    </button>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-dim">No role clue assigned.</p>
                )}
              </div>
            )}

          </div>
        )}

        <div className="border-t border-bone/15 bg-void/95 px-3 pb-3 pt-2 backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between gap-2 text-[9px] uppercase tracking-[0.14em] text-dim">
            <span className="flex items-center gap-2">
              <SuitMark className="text-[11px] text-gold" />
              <span className="text-gold">{g.roleLabel}</span>
            </span>
            <span>
              Pts <span className="mono text-bone">{me?.points ?? 0}</span>
            </span>
            <span>
              Next <span className="mono text-bone">{secs == null ? "--" : secs.toFixed(1) + "s"}</span>
            </span>
          </div>

          {lockedAllies.length > 0 && (
            <div className="mb-2 rounded-lg border border-red/50 bg-red/5 p-2">
              <p className="mono text-[9px] uppercase tracking-[0.18em] text-red">Free a teammate</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {lockedAllies.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    onClick={() => g.sendUnlock(player.id)}
                    className="border border-red/50 px-2 py-1 text-[10px] text-red transition hover:bg-red/10"
                  >
                    Scan {player.name} free
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mb-1 flex items-center gap-2">
            <button
              type="button"
              onClick={sendWait}
              className="rounded-lg border border-edge bg-ink/50 px-3 py-2 text-[10px] text-dim transition hover:border-yellow hover:text-yellow"
              title="Wait (−1 point)"
            >
              WAIT
            </button>
            <span className="text-[9px] leading-tight text-dim">Tap a door to open it for 10s, then walk in.</span>
          </div>

          <div className="grid grid-cols-2 gap-1">
            {([
              ["map", "Map"],
              ["chat", "Chat"],
              ["puzzle", "Marks"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMobilePanel((current) => (current === key ? "none" : key))}
                aria-pressed={mobilePanel === key}
                className={`rounded-lg border py-1.5 text-[10px] uppercase tracking-[0.12em] transition ${
                  mobilePanel === key
                    ? "border-gold/60 bg-gold/10 text-gold"
                    : "border-edge text-dim hover:text-bone"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* event toasts */}
      <div
        aria-live="polite"
        className="pointer-events-none absolute bottom-44 left-1/2 z-20 flex w-[min(520px,90vw)] -translate-x-1/2 flex-col items-center gap-2 xl:bottom-32"
      >
        {g.doorEvent?.locked && (
          <div className="animate-toast-in rounded-xl border border-red/60 bg-ink/90 px-4 py-2 text-xs text-red backdrop-blur">
            {g.doorEvent?.message || "Lockdown. Two teammates must scan your wristband free."}
          </div>
        )}
        {g.doorEvent && g.doorEvent.accepted && (
          <div className="animate-toast-in rounded-xl border border-green/60 bg-ink/90 px-4 py-2 text-xs text-green backdrop-blur">
            {g.doorEvent.color ?? g.doorEvent.door} door open for 10s
            {g.doorEvent.target_code ? ` → ${g.doorEvent.target_code}` : ""}
            <span className="mono ml-1 text-yellow">−{g.doorEvent.cost ?? 1} pt</span>
          </div>
        )}
        {g.cross.id > 0 && g.cross.player === g.you && (
          <div className="animate-toast-in rounded-xl border border-blue/60 bg-ink/90 px-4 py-2 text-xs text-blue backdrop-blur">
            Entered {g.cross.to ?? "the next room"} · free crossing
          </div>
        )}
        {g.doorEvent && !g.doorEvent.accepted && !g.doorEvent.locked && g.doorEvent.message && (
          <div className="animate-toast-in rounded-xl border border-edge bg-ink/90 px-4 py-2 text-xs text-dim backdrop-blur">
            {g.doorEvent.message}
          </div>
        )}
        {g.hazard && (
          <div className="animate-toast-in rounded-xl border border-red/60 bg-ink/90 px-4 py-2 text-xs text-red backdrop-blur">
            Sanction room {g.hazard.room_code} · −{g.hazard.penalty} points
          </div>
        )}
        {g.revive && (
          <div className="animate-toast-in rounded-xl border border-green/60 bg-ink/90 px-4 py-2 text-xs text-green backdrop-blur">
            A locked player was scanned free.
          </div>
        )}
        {g.exitNotice && (
          <div className="animate-toast-in rounded-xl border border-yellow/60 bg-ink/90 px-4 py-2 text-xs text-yellow backdrop-blur">
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
        <div className="absolute inset-0 z-30 grid place-items-center bg-void/80 backdrop-blur-sm">
          <div className="hud w-[min(460px,92vw)] rounded-3xl p-8 text-center animate-rise">
            <p className="mono text-[10px] uppercase tracking-[0.3em] text-yellow">The Last Room</p>
            <h2 className="mt-2 text-2xl font-semibold">Assembling the team</h2>
            <p className="mt-2 text-sm text-dim">
              Share room <span className="mono text-gold">{room}</span> — the whole team can join before the arena starts.
            </p>
            <p className="mt-1 text-xs text-dim">
              {g.players.filter((p) => p.connected).length} of {g.minPlayers} joined · press Ready. The match begins when all connected players are ready.
            </p>
            <ul className="mt-4 space-y-2 text-left">
              {g.players.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <Avatar
                    src={p.avatar_url}
                    name={p.name}
                    color={p.color}
                    size={28}
                  />
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
              Spawn in C3. Find the hidden exit and bring every living player into it. 15 points each.
            </p>
          </div>
        </div>
      )}

      {isOver && !g.error && g.connected && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-void/80 backdrop-blur-sm">
          <div className="hud w-[min(460px,92vw)] rounded-3xl p-8 text-center animate-rise">
            <p className="mono text-[10px] uppercase tracking-[0.3em] text-yellow">
              {g.status === "won" ? "Escape" : "Game over"}
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              {g.status === "won" ? "Every living player reached the exit." : "The Last Room claims you."}
            </h2>
            <p className="mt-2 text-sm text-dim">
              {g.gameOver?.summary
                ? `${g.gameOver.summary.rounds} rounds · ${g.gameOver.summary.eliminated} eliminated · team skill ${Math.round((g.gameOver.summary.team_skill ?? 0) * 100)}%`
                : ""}
            </p>
            <div className="mt-4 space-y-1 text-left">
              {(g.gameOver?.summary?.players ?? []).map((p: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar src={p.avatar_url} name={p.name} size={24} showSuit={false} />
                    <span className="truncate">{p.name}</span>
                  </span>
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
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-void/45">
          <p className="rounded-2xl border border-red/60 bg-ink/90 px-6 py-3 text-sm text-red backdrop-blur">
            Points spent. You are eliminated — the team plays on.
          </p>
        </div>
      )}

      {(g.error || !g.connected) && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-void/90">
          <div className="broadcast-panel panel-cut px-6 py-4 text-center">
            {g.error ? (
              <div>
                <p className="text-red">{g.error}</p>
                <a
                  href="/lobby"
                  className="mt-4 inline-block rounded-lg border border-edge px-4 py-2 text-[10px] uppercase tracking-[0.16em] text-dim transition hover:border-bone hover:text-bone"
                >
                  Back to lobby
                </a>
              </div>
            ) : g.attempts > 0 ? (
              <p className="text-dim">Reconnecting to the arena… attempt {g.attempts}</p>
            ) : (
              <p className="text-dim">Connecting to the arena…</p>
            )}
          </div>
        </div>
      )}

      {g.restored && g.connected && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2">
          <p className="mono border border-green/50 bg-void/90 px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-green">
            State restored
          </p>
        </div>
      )}

      <div className="mono pointer-events-none absolute bottom-2 right-3 z-10 hidden text-[10px] text-dim xl:block">
        {alive.length}/{g.players.length} alive · exit {me?.exit_found ? "found" : "hidden"}
      </div>
    </main>
  );
}

function futureTone(future?: string) {
  if (future === "sanction") return "text-red";
  if (future === "open") return "text-green";
  return "text-dim";
}
