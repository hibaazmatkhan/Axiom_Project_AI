"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import GameCanvas from "./GameCanvas";
import WristbandMap from "./WristbandMap";
import { SuitMark } from "./Brand";
import Avatar from "./Avatar";
import { useGameSocket } from "@/lib/useGameSocket";
import { playSound, setKingProximity, setMuted, stopSounds, unlockAudio } from "@/lib/audio";
import type { DelayCell, DelayKeyView, DelayPuzzleView, DelayStatusView, NoteLine, Sigil } from "@/lib/types";

const SIGILS = ["spade", "heart", "diamond", "club"] as const;
const SIGIL_GLYPH: Record<string, string> = {
  spade: "\u2660", heart: "\u2665", diamond: "\u2666", club: "\u2663",
};
const MAX_POINTS = 25;
const LOSS_HEADLINES: Record<string, string> = {
  king: "Killed by the KING OF SPADES",
  points_zero: "Your points reached zero",
  time_up: "Time expired before the exit",
  round_limit: "The final shift ended",
  team_eliminated: "The team failed to escape",
};

function lossHeadline(code?: string) {
  if (code && LOSS_HEADLINES[code]) return LOSS_HEADLINES[code];
  return "The Last Room claims you.";
}

function formatClock(value: number) {
  const total = Math.max(0, Math.ceil(value));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function Panel({ children, className = "", compact = false }: {
  children: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return <section className={`broadcast-panel panel-cut ${compact ? "p-2" : "p-4"} ${className}`}>{children}</section>;
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

function NotesPanel({
  lines, draft, setDraft, onSend, ghost,
}: {
  lines: NoteLine[];
  draft: string;
  setDraft: (value: string) => void;
  onSend: () => void;
  ghost: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest text-dim">Team notes</span>
        <span className="mono text-[9px] text-dim">{lines.length}/40</span>
      </div>
      <div className="scroll-thin mt-2 max-h-28 space-y-1 overflow-y-auto">
        {lines.length === 0 && <p className="text-[11px] text-dim">Shared deductions appear here.</p>}
        {lines.map((line) => (
          <p key={line.id} className="text-[11px]">
            <span style={{ color: line.color }} className="font-medium">{line.from}</span>
            <span className="text-bone"> · {line.text}</span>
          </p>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft.trim()) onSend();
          }}
          placeholder={ghost ? "Ghosts can keep notes" : "Record a clue…"}
          className="min-w-0 flex-1 rounded-lg border border-edge bg-ink/60 px-2 py-1.5 text-xs outline-none focus:border-blue"
        />
        <button
          type="button"
          onClick={onSend}
          className="rounded-lg border border-edge px-2 text-[10px] text-dim transition hover:border-blue hover:text-bone"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function DelayGrid({
  grid, highlight, onPick,
}: {
  grid: (Sigil | null)[][];
  highlight?: DelayCell | null;
  onPick?: (cell: DelayCell) => void;
}) {
  const cols = grid[0]?.length === 4 ? "grid-cols-4" : "grid-cols-3";
  return (
    <div className={`mt-1 grid w-fit gap-1 ${cols}`}>
      {grid.flatMap((row, rowIndex) => row.map((suit, colIndex) => {
        const marked = highlight?.row === rowIndex && highlight.col === colIndex;
        return (
          <button
            key={`${rowIndex}-${colIndex}`}
            type="button"
            disabled={!onPick}
            onClick={() => onPick?.({ row: rowIndex, col: colIndex })}
            className={`flex h-8 w-8 items-center justify-center rounded border text-sm transition ${
              marked
                ? "border-yellow bg-yellow/15 text-yellow"
                : onPick
                  ? "border-edge text-bone hover:border-blue hover:text-blue"
                  : "border-edge/50 text-dim"
            }`}
          >
            {suit ? SIGIL_GLYPH[suit] : "·"}
          </button>
        );
      }))}
    </div>
  );
}

function DelayBoard({
  puzzle, clock, onAnswer, interactive = true,
}: {
  puzzle: DelayPuzzleView;
  clock: number | null;
  onAnswer: (answer: DelayCell | Sigil) => void;
  interactive?: boolean;
}) {
  const pct = clock == null || puzzle.answer_ms <= 0
    ? 0
    : Math.max(0, Math.min(100, (clock / (puzzle.answer_ms / 1000)) * 100));
  return (
    <div className="mt-2">
      <p className="text-xs leading-relaxed text-bone">{puzzle.question}</p>
      <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-dim">
        <span>Answer clock</span>
        <span className="mono text-yellow">{clock == null ? "--" : `${clock.toFixed(1)}s`}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-void/70">
        <div className="h-full rounded-full bg-gradient-to-r from-red to-yellow" style={{ width: `${pct}%` }} />
      </div>
      {puzzle.grids.before && (
        <div className="mt-2">
          <span className="mono text-[10px] uppercase tracking-widest text-dim">
            {puzzle.tier === 2 ? "Grid · tap destination" : "Before"}
          </span>
          <DelayGrid
            grid={puzzle.grids.before}
            highlight={puzzle.highlight}
            onPick={interactive && puzzle.tier === 2 ? onAnswer : undefined}
          />
        </div>
      )}
      {puzzle.grids.after && (
        <div className="mt-2">
          <span className="mono text-[10px] uppercase tracking-widest text-dim">After · tap one tile</span>
          <DelayGrid
            grid={puzzle.grids.after}
            highlight={puzzle.highlight}
            onPick={interactive ? onAnswer : undefined}
          />
        </div>
      )}
      {puzzle.grids.given && (
        <div className="mt-2">
          <span className="mono text-[10px] uppercase tracking-widest text-dim">
            {puzzle.tier === 2 ? "Grid · tap destination" : "Grid · marked tile"}
          </span>
          <DelayGrid
            grid={puzzle.grids.given}
            highlight={puzzle.highlight}
            onPick={interactive && puzzle.tier === 2 ? onAnswer : undefined}
          />
        </div>
      )}
      {puzzle.tier === 3 && (
        <div className="mt-2 grid grid-cols-4 gap-1">
          {SIGILS.map((suit) => (
            <button
              key={suit}
              type="button"
              disabled={!interactive}
              onClick={() => onAnswer(suit)}
              className="rounded-lg border border-edge py-1 text-sm text-bone transition hover:border-yellow hover:text-yellow disabled:opacity-50"
              title={suit}
            >
              {SIGIL_GLYPH[suit]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DelayKeyPanel({
  keyView, status,
}: {
  keyView: DelayKeyView | null;
  status: DelayStatusView | null;
}) {
  return (
    <div className="mt-2">
      {status && (
        <div className="space-y-1.5">
          <Stat label="State" value={status.state} accent="text-yellow" />
          <Stat label="Attempts left" value={status.attempts_left} accent="text-blue" />
          {status.state === "cooldown" && (
            <Stat label="Recharging" value={`${formatClock(status.cooldown_s)}`} accent="text-dim" />
          )}
        </div>
      )}
      {keyView ? (
        <div className="mt-3 rounded-lg border border-yellow/40 bg-yellow/5 px-2 py-2">
          <p className="text-xs leading-relaxed text-bone">{keyView.key_text}</p>
          {keyView.key_cells && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-yellow">
              {keyView.key_cells.map((cell) => (
                <span key={`${cell.row}-${cell.col}`} className="mono">
                  {cell.row + 1},{cell.col + 1} · {SIGIL_GLYPH[cell.suit]}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-[11px] leading-relaxed text-dim">
          No key yet. Queue a tier and pass it to the Decoder by voice.
        </p>
      )}
    </div>
  );
}

export default function GameClient({ room, name }: { room: string; name: string }) {
  const router = useRouter();
  const g = useGameSocket(room, name);
  const [secs, setSecs] = useState<number | null>(null);
  const [matchSecs, setMatchSecs] = useState<number | null>(null);
  const [delaySecs, setDelaySecs] = useState<number | null>(null);
  const [kingWatchSecs, setKingWatchSecs] = useState<number | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"none" | "map" | "notes" | "intel" | "puzzle" | "delay">("none");
  const [teamOpen, setTeamOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [soundMuted, setSoundMuted] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [puzzleMark, setPuzzleMark] = useState("");
  const [kingStrikeAt, setKingStrikeAt] = useState(0);
  const teamRef = useRef<HTMLDivElement>(null);
  const lastWatchSound = useRef("");
  const { sendOpenDoor, sendCrossDoor, sendWait, sendRevealWristband, sendDelayQueue, sendDelayAnswer, exitMatch } = g;

  const me = g.me;
  const ghost = !!me?.eliminated && g.status === "running";
  const handleExit = () => {
    exitMatch();
    router.push("/lobby");
  };
  const wristbandCooldown = g.wristbandCooldownAt == null
    ? 0
    : Math.max(0, (g.wristbandCooldownAt - performance.now()) / 1000);
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
      if (k === " " || k === "spacebar") {
        e.preventDefault();
        if (!ghost) sendWait();
        return;
      }
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        e.preventDefault();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ghost, sendWait]);

  useEffect(() => {
    const tick = () => {
      setSecs(g.nextAt == null ? null : Math.max(0, (g.nextAt - performance.now()) / 1000));
      setMatchSecs(g.matchAt == null ? null : Math.max(0, (g.matchAt - performance.now()) / 1000));
      setDelaySecs(g.delayDeadlineAt == null ? null : Math.max(0, (g.delayDeadlineAt - performance.now()) / 1000));
      setKingWatchSecs(g.kingWatch == null ? null : Math.max(0, (g.kingWatch.starts_at * 1000 - Date.now()) / 1000));
    };
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [g.nextAt, g.matchAt, g.delayDeadlineAt, g.kingWatch]);


  useEffect(() => {
    setPuzzleMark(g.puzzle?.you?.mark ?? "");
  }, [g.puzzle?.you?.role, g.puzzle?.you?.domain.join("|"), g.puzzle?.you?.mark]);

  useEffect(() => {
    if (g.kingEvent?.type !== "kill") return;
    setKingStrikeAt(performance.now());
    const timer = window.setTimeout(() => setKingStrikeAt(0), 1500);
    return () => window.clearTimeout(timer);
  }, [g.kingEvent?.id, g.kingEvent?.type]);

  useEffect(() => {
    setMuted(soundMuted);
  }, [soundMuted]);

  useEffect(() => () => {
    setKingProximity(false);
    stopSounds();
  }, []);

  useEffect(() => {
    const active = g.status === "running" && !!g.king && !me?.eliminated
      && !!me?.room_code && g.king.room_code === me.room_code;
    setKingProximity(active);
    return () => setKingProximity(false);
  }, [g.status, g.king?.id, g.king?.room_code, g.king?.teleport_index, me?.room_code, me?.eliminated]);

  useEffect(() => {
    if (!g.kingWatch || lastWatchSound.current === g.kingWatch.id) return;
    lastWatchSound.current = g.kingWatch.id;
    playSound("warning");
  }, [g.kingWatch]);

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

  const dealerLead = `${g.dealerClue?.text ?? ""} ${g.dealerNudge?.text ?? ""} ${g.dealerNudge?.puzzle ?? ""}`;
  const sanctionLead = /sanction/i.test(dealerLead);
  const lockedAllies = g.players.filter(
    (p) => p.locked && !p.eliminated && p.id !== g.you
  );
  const alive = g.players.filter((p) => !p.eliminated);
  const teamRoster = useMemo(() => [...g.players].sort((a, b) => a.slot - b.slot), [g.players]);
  const isLobby = g.status === "lobby";
  const isOver = g.status === "won" || g.status === "over";
  const sendNote = () => {
    if (!noteInput.trim()) return;
    g.sendNotes(noteInput.trim());
    setNoteInput("");
  };

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
        king={g.king}
        kingEvent={g.kingEvent}
        elimination={g.eliminated}
        ghost={ghost}
        poses={g.poses}
        exitWall={me?.exit_wall ?? []}
        onOpenDoor={sendOpenDoor}
        onCrossDoor={sendCrossDoor}
        onPose={g.sendPose}
      />

      {kingStrikeAt > 0 && (
        <div
          className="pointer-events-none absolute inset-0 z-[70] flex items-center justify-center"
          style={{ background: "radial-gradient(circle, rgba(90,0,0,0.08) 10%, rgba(145,0,8,0.82) 100%)" }}
        >
          <span className="mono text-2xl uppercase tracking-[0.4em] text-red drop-shadow-[0_0_18px_rgba(255,0,0,0.9)]">
            King of Spades
          </span>
        </div>
      )}

      {g.role === "watcher" && g.kingWatch && (
        <div className="pointer-events-none absolute inset-x-0 top-20 z-[60] flex justify-center px-3 sm:top-24">
          <div className="mono flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border border-red/70 bg-void/95 px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-red shadow-hud backdrop-blur">
            <span>King warning</span>
            <span className="text-base tabular-nums text-bone">
              {formatClock(kingWatchSecs ?? g.kingWatch.in_seconds)}
            </span>
            <span className="text-dim">
              Now <span className="text-gold">{g.kingWatch.room_code ?? "--"}</span>
              {" · "}
              {g.kingWatch.appearances
                .map((item) => `#${item.appearance} ${item.rooms.map((room) => room.room_code ?? "--").join("→")}`)
                .join(" | ")}
            </span>
          </div>
        </div>
      )}

      {g.status === "running" && (
        <div className="pointer-events-none absolute bottom-1 left-1/2 z-10 -translate-x-1/2">
          <p className="mono rounded-full border border-bone/15 bg-void/70 px-3 py-1 text-[9px] uppercase tracking-[0.16em] text-dim backdrop-blur">
            {ghost
              ? "Ghost · role intel and notes stay live · movement and doors are disabled"
              : "Click to lock cursor · mouse to look · click a door to open · WASD to walk · Esc releases"}
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
            R<span className="mono ml-1 text-bone">{g.round}</span>
            {g.maxRounds > 0 ? `/${g.maxRounds}` : ""}
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
          <button
            type="button"
            onClick={() => {
              unlockAudio();
              setSoundMuted((value) => !value);
            }}
            aria-label={soundMuted ? "Unmute sounds" : "Mute sounds"}
            title={soundMuted ? "Unmute sounds" : "Mute sounds"}
            className="border border-edge bg-void/85 px-2.5 py-2 text-[10px] uppercase tracking-[0.14em] text-dim backdrop-blur transition hover:border-gold/50 hover:text-bone"
          >
            {soundMuted ? "Sound off" : "Sound on"}
          </button>
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
          {g.role === "timekeeper" && (
            <div className="border border-edge bg-void/85 px-3 py-1.5 text-center backdrop-blur sm:px-4 sm:py-2">
              <div className="mono text-[8px] uppercase tracking-[0.18em] text-dim sm:text-[10px]">
                Next shift
              </div>
              <div className={`mono text-base tabular-nums sm:text-lg ${secs != null && secs < 4 ? "text-red" : "text-bone"}`}>
                {secs == null ? "--" : secs.toFixed(1) + "s"}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={handleExit}
            aria-label="Exit match"
            title="Leave this match and return to lobby"
            className="flex items-center gap-1 border border-red/40 bg-void/85 px-2.5 py-2 text-[10px] uppercase tracking-[0.14em] text-red backdrop-blur transition hover:border-red/70 hover:bg-red/10"
          >
            <span aria-hidden="true">←</span>
            Exit
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
      <button
        type="button"
        onClick={() => setLeftOpen((open) => !open)}
        aria-expanded={leftOpen}
        aria-label={leftOpen ? "Hide left panels" : "Show left panels"}
        className={`absolute top-20 z-30 hidden h-8 w-7 items-center justify-center border border-edge bg-void/90 text-xs text-dim backdrop-blur transition hover:border-gold/60 hover:text-bone xl:flex ${
          leftOpen ? "left-[17.25rem]" : "left-4"
        }`}
      >
        {leftOpen ? "‹" : "›"}
      </button>
      <div className={`absolute left-4 top-20 z-20 hidden max-h-[calc(100vh-6rem)] w-64 space-y-3 overflow-y-auto pb-4 scroll-thin transition-all duration-300 xl:block ${
        leftOpen ? "opacity-100" : "pointer-events-none -translate-x-4 opacity-0"
      }`}>
        <Panel>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-dim">Your role</span>
            <span className="mono text-sm text-blue">{g.roleLabel}</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-dim">{g.roleHint}</p>
          {g.role === "pathfinder" && (
            <button
              type="button"
              onClick={sendRevealWristband}
              disabled={ghost || !g.connected || !!me?.wristband_revealed || wristbandCooldown > 0}
              className="mt-3 w-full rounded-lg border border-blue/60 py-1.5 text-xs text-blue transition hover:bg-blue/10 disabled:cursor-not-allowed disabled:border-edge disabled:text-dim disabled:hover:bg-transparent"
            >
              {ghost
                ? "Ghosts cannot scan"
                : me?.wristband_revealed
                  ? "Wristband revealed · next shift"
                  : wristbandCooldown > 0
                    ? `Scan recharging · ${formatClock(wristbandCooldown)}`
                    : "Reveal wristband map"}
            </button>
          )}
          {g.role === "timekeeper" && (
            <div className="mt-3 border-t border-edge/40 pt-3">
              <span className="mono text-[10px] uppercase tracking-widest text-dim">Delay queue</span>
              <div className="mt-2 grid grid-cols-3 gap-1">
                {([1, 2, 3] as const).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => sendDelayQueue(tier)}
                    disabled={ghost || !g.connected || g.delayStatus?.state === "solving" || g.delayStatus?.state === "cooldown" || (g.delayStatus?.attempts_left ?? 0) <= 0}
                    className="rounded-lg border border-yellow/50 py-1.5 text-xs text-yellow transition hover:bg-yellow/10 disabled:cursor-not-allowed disabled:border-edge disabled:text-dim disabled:hover:bg-transparent"
                  >
                    Tier {tier}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-dim">
                {secs == null ? "--" : `${secs.toFixed(1)}s to shift`} · {g.delayStatus?.attempts_left ?? 0} attempts left
              </p>
            </div>
          )}
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
          <WristbandMap
            arena={g.arena}
            wristband={g.wristband}
            youCode={me?.room_code ?? null}
            exitCode={me?.exit_code ?? null}
            showSanctions={!!me?.wristband_revealed}
            sanctionRooms={g.wristbandSanctions}
            className="mt-2"
          />
          <p className="mt-2 text-[10px] leading-relaxed text-dim">
            Edge bars are door colours. The Pathfinder scan reveals blocked walls and sanction rooms until the next shift; D10 seals stay hidden.
          </p>
        </Panel>

        {!ghost && lockedAllies.length > 0 && (
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
      <button
        type="button"
        onClick={() => setRightOpen((open) => !open)}
        aria-expanded={rightOpen}
        aria-label={rightOpen ? "Hide right panels" : "Show right panels"}
        className={`absolute top-20 z-30 hidden h-8 w-7 items-center justify-center border border-edge bg-void/90 text-xs text-dim backdrop-blur transition hover:border-gold/60 hover:text-bone xl:flex ${
          rightOpen ? "right-[19.5rem]" : "right-4"
        }`}
      >
        {rightOpen ? "›" : "‹"}
      </button>
      <div className={`absolute right-4 top-20 z-20 hidden max-h-[calc(100vh-6rem)] w-72 space-y-3 overflow-y-auto pb-4 scroll-thin transition-all duration-300 xl:block ${
        rightOpen ? "opacity-100" : "pointer-events-none translate-x-4 opacity-0"
      }`}>
        {(g.dealerClue || g.dealerNudge) && (
          <Panel compact className={sanctionLead ? "border-yellow/60 bg-yellow/[0.06]" : ""}>
            <div className="flex items-center justify-between gap-2">
              <span className="mono text-[9px] uppercase tracking-[0.18em] text-dim">Dealer</span>
              {sanctionLead && (
                <span className="mono rounded-full border border-yellow/50 px-2 py-0.5 text-[8px] uppercase tracking-[0.14em] text-yellow">
                  Sanction lead
                </span>
              )}
            </div>
            {g.dealerClue && (
              <p className={`mt-1.5 text-[11px] leading-snug ${sanctionLead ? "text-yellow" : "text-bone"}`}>
                “{g.dealerClue.text}”
              </p>
            )}
            {g.dealerNudge && (
              <p className="mt-1.5 text-[10px] leading-snug text-dim">
                Whisper · {g.dealerNudge.text}
                {g.dealerNudge.puzzle ? ` ${g.dealerNudge.puzzle}` : ""}
              </p>
            )}
          </Panel>
        )}

        {(g.role === "timekeeper" || g.role === "decoder") && (
          <Panel>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-dim">
                {g.role === "timekeeper" ? "Delay key" : "Puzzle"}
              </span>
              <span className="mono text-[10px] text-dim">{g.role}</span>
            </div>

            {g.role === "timekeeper" ? (
              <DelayKeyPanel keyView={g.delayKey} status={g.delayStatus} />
            ) : g.delayPuzzle ? (
              <DelayBoard
                puzzle={g.delayPuzzle}
                clock={delaySecs}
                interactive={!ghost}
                onAnswer={(answer) =>
                  g.sendDelayAnswer(g.delayPuzzle!.puzzle_id, answer)
                }
              />
            ) : (
              <p className="mt-2 text-[11px] leading-relaxed text-dim">
                Waiting for the Timekeeper to queue a puzzle.
              </p>
            )}
          </Panel>
        )}

        {g.role === "watcher" && (
          <Panel className="border-red/40">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-red">Watcher</span>
              <span className="mono text-[10px] text-dim">
                {g.kingWatch ? `appearance ${g.kingWatch.appearance}/${g.kingWatch.total}` : "standing by"}
              </span>
            </div>
            {g.kingWatch ? (
              <div className="mt-2 space-y-1">
                <p className="mono text-lg text-red">
                  {formatClock(kingWatchSecs ?? g.kingWatch.in_seconds)}
                </p>
                <div className="space-y-1">
                  {g.kingWatch.appearances.map((item) => (
                    <p key={item.appearance} className="text-[10px] leading-relaxed text-bone">
                      #{item.appearance} · {item.rooms.map((room) => room.room_code ?? "--").join(" → ")}
                    </p>
                  ))}
                </div>
                <p className="text-[10px] leading-relaxed text-dim">
                  All five appearances and every teleport room are revealed to the watcher.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-[11px] leading-relaxed text-dim">
                No KING warning active. Warn the team when the signal arrives.
              </p>
            )}
          </Panel>
        )}

        <Panel>
          <NotesPanel
            lines={g.notes}
            draft={noteInput}
            setDraft={setNoteInput}
            onSend={sendNote}
            ghost={ghost}
          />
        </Panel>

        <Panel>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-dim">Role mark puzzle</span>
            <span className="mono text-[10px] text-dim">
              {g.puzzle?.public?.solved
                ? "solved"
                : `${g.puzzle?.public?.marks ?? 0}/4 set · ${g.puzzle?.public?.attempts ?? 0} tries`}
            </span>
          </div>
          {g.puzzle?.you ? (
            <>
              <p className="mt-1 text-[11px] leading-relaxed text-dim">
                {g.puzzle.you.mark
                  ? `Your mark is ${SIGIL_GLYPH[g.puzzle.you.mark] ?? g.puzzle.you.mark}. Change it if the shared clues point elsewhere.`
                  : "Set only your role's mark. Share the clues; every role must contribute."}
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
                disabled={ghost || !puzzleMark}
                className="mt-3 w-full rounded-lg bg-bone py-2 text-sm font-semibold text-coal transition hover:brightness-95 disabled:opacity-40"
              >
                {ghost ? "Ghosts cannot submit" : "Submit role mark"}
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
                {g.role === "pathfinder" && (
                  <button
                    type="button"
                    onClick={sendRevealWristband}
                    disabled={ghost || !g.connected || !!me?.wristband_revealed || wristbandCooldown > 0}
                    className="mt-2 w-full rounded-lg border border-blue/60 py-1.5 text-xs text-blue transition hover:bg-blue/10 disabled:cursor-not-allowed disabled:border-edge disabled:text-dim disabled:hover:bg-transparent"
                  >
                    {ghost
                      ? "Ghosts cannot scan"
                      : me?.wristband_revealed
                        ? "Wristband revealed · next shift"
                        : wristbandCooldown > 0
                          ? `Scan recharging · ${formatClock(wristbandCooldown)}`
                          : "Reveal wristband map"}
                  </button>
                )}
                <WristbandMap
                  arena={g.arena}
                  wristband={g.wristband}
                  youCode={me?.room_code ?? null}
                  exitCode={me?.exit_code ?? null}
                  showSanctions={!!me?.wristband_revealed}
                  sanctionRooms={g.wristbandSanctions}
                  className="mt-2"
                />
                <p className="mt-2 text-[10px] leading-relaxed text-dim">
                  Edge bars are door colours. The Pathfinder scan reveals blocked walls and sanction rooms until the next shift.
                </p>
              </div>
            )}

            {mobilePanel === "delay" && (
              <div>
                {g.role === "timekeeper" ? (
                  <>
                    <span className="mono text-[10px] uppercase tracking-[0.2em] text-gold">Delay queue</span>
                    <div className="mt-2 grid grid-cols-3 gap-1">
                      {([1, 2, 3] as const).map((tier) => (
                        <button
                          key={tier}
                          type="button"
                          onClick={() => sendDelayQueue(tier)}
                          disabled={ghost || !g.connected || g.delayStatus?.state === "solving" || g.delayStatus?.state === "cooldown" || (g.delayStatus?.attempts_left ?? 0) <= 0}
                          className="rounded-lg border border-yellow/50 py-1.5 text-xs text-yellow transition hover:bg-yellow/10 disabled:cursor-not-allowed disabled:border-edge disabled:text-dim"
                        >
                          Tier {tier}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-[10px] text-dim">
                      {secs == null ? "--" : `${secs.toFixed(1)}s to shift`} · {g.delayStatus?.attempts_left ?? 0} attempts left
                    </p>
                    <DelayKeyPanel keyView={g.delayKey} status={g.delayStatus} />
                  </>
                ) : g.role === "decoder" ? (
                  g.delayPuzzle ? (
                    <DelayBoard
                      puzzle={g.delayPuzzle}
                      clock={delaySecs}
                      onAnswer={(answer) => g.sendDelayAnswer(g.delayPuzzle!.puzzle_id, answer)}
                    />
                  ) : (
                    <p className="mt-2 text-xs text-dim">Waiting for the Timekeeper to queue a puzzle.</p>
                  )
                ) : (
                  <p className="mt-2 text-xs text-dim">Your role has no delay puzzle.</p>
                )}
              </div>
            )}

            {mobilePanel === "notes" && (
              <div>
                <NotesPanel
                  lines={g.notes}
                  draft={noteInput}
                  setDraft={setNoteInput}
                  onSend={sendNote}
                  ghost={ghost}
                />
              </div>
            )}

            {mobilePanel === "intel" && (
              <div>
                <span className="mono text-[10px] uppercase tracking-[0.2em] text-gold">Role intel</span>
                {g.role === "pathfinder" && (
                  <p className="mt-2 text-[11px] leading-relaxed text-bone">
                    {g.transition.moved.length === 0
                      ? "No rooms moved in the last shift."
                      : g.transition.moved.map((room) => `${room.code_from}→${room.code_to}`).join(" · ")}
                  </p>
                )}
                {g.role === "watcher" && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {g.transition.sigils.length === 0
                      ? <p className="text-[11px] text-dim">No sigil moved in the last shift.</p>
                      : g.transition.sigils.map((sigil, index) => (
                          <span key={`${sigil}-${index}`} className="rounded-full border border-red/40 px-2 py-0.5 text-xs text-red">
                            {SIGIL_GLYPH[sigil] ?? sigil}
                          </span>
                        ))}
                  </div>
                )}
                {g.role === "decoder" && (
                  <p className="mt-2 text-[11px] leading-relaxed text-bone">
                    {g.transition.previous
                      ? `Prior layout: ${g.transition.previous.rooms.map((room) => room.code).join(" · ")}`
                      : "No previous layout captured yet."}
                  </p>
                )}
                {g.role === "timekeeper" && (
                  <p className="mt-2 text-[11px] leading-relaxed text-dim">
                    Timing intel appears in the Next shift counter above.
                  </p>
                )}
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
                      disabled={ghost || !puzzleMark}
                      className="mt-2 w-full rounded-lg bg-bone py-2 text-xs font-semibold text-coal disabled:opacity-40"
                    >
                      {ghost ? "Ghosts cannot submit" : "Submit role mark"}
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
            {g.role === "timekeeper" && (
              <span>
                Next <span className="mono text-bone">{secs == null ? "--" : secs.toFixed(1) + "s"}</span>
              </span>
            )}
          </div>

          {!ghost && lockedAllies.length > 0 && (
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
              disabled={ghost}
              className="rounded-lg border border-edge bg-ink/50 px-3 py-2 text-[10px] text-dim transition hover:border-yellow hover:text-yellow disabled:cursor-not-allowed disabled:opacity-40"
              title="Wait (−1 point)"
            >
              WAIT
            </button>
            <span className="text-[9px] leading-tight text-dim">
              {ghost ? "Ghosts can watch and keep notes, but cannot act." : "Tap a door to open it for 10s, then walk in."}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1">
            {(g.role === "timekeeper" || g.role === "decoder"
              ? ([
                  ["map", "Map"],
                  ["notes", "Notes"],
                  ["intel", "Intel"],
                  ["puzzle", "Marks"],
                  ["delay", "Delay"],
                ] as const)
              : ([
                  ["map", "Map"],
                  ["notes", "Notes"],
                  ["intel", "Intel"],
                  ["puzzle", "Marks"],
                ] as const)
            ).map(([key, label]) => (
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
        {g.sealedAlert && (
          <div
            key={`sealed-${g.sealedAlert.id}`}
            className="animate-toast-sealed rounded-xl border border-yellow/70 bg-ink/95 px-4 py-2 text-xs text-yellow backdrop-blur"
          >
            {g.sealedAlert.message}
            {g.sealedAlert.points !== undefined && (
              <span className="mono ml-2 text-dim">{g.sealedAlert.points} pts</span>
            )}
          </div>
        )}
        {g.doorEvent?.locked && (
          <div
            key={`locked-${g.doorEvent.id}`}
            className="animate-toast-in rounded-xl border border-red/60 bg-ink/90 px-4 py-2 text-xs text-red backdrop-blur"
          >
            {g.doorEvent?.message || "Lockdown. Two teammates must scan your wristband free."}
          </div>
        )}
        {g.doorEvent && g.doorEvent.accepted && (
          <div
            key={`door-${g.doorEvent.id}`}
            className="animate-toast-in rounded-xl border border-green/60 bg-ink/90 px-4 py-2 text-xs text-green backdrop-blur"
          >
            {g.doorEvent.color ?? g.doorEvent.door} door open for 10s
            {g.doorEvent.target_code ? ` → ${g.doorEvent.target_code}` : ""}
            <span className="mono ml-1 text-yellow">−{g.doorEvent.cost ?? 1} pt</span>
          </div>
        )}
        {g.cross.id > 0 && g.cross.player === g.you && (
          <div
            key={`cross-${g.cross.id}`}
            className="animate-toast-in rounded-xl border border-blue/60 bg-ink/90 px-4 py-2 text-xs text-blue backdrop-blur"
          >
            Entered {g.cross.to ?? "the next room"} · free crossing
          </div>
        )}
        {g.doorEvent && !g.doorEvent.accepted && !g.doorEvent.locked && !g.doorEvent.sealed && g.doorEvent.message && (
          <div
            key={`rejected-${g.doorEvent.id}`}
            className="animate-toast-in rounded-xl border border-edge bg-ink/90 px-4 py-2 text-xs text-dim backdrop-blur"
          >
            {g.doorEvent.message}
          </div>
        )}
        {g.hazard && (
          <div
            key={`hazard-${g.hazard.id}`}
            className="animate-toast-in rounded-xl border border-red/60 bg-ink/90 px-4 py-2 text-xs text-red backdrop-blur"
          >
            Sanction room {g.hazard.room_code} · −{g.hazard.penalty} points
          </div>
        )}
        {g.revive && (
          <div
            key={`revive-${g.revive.id}`}
            className="animate-toast-in rounded-xl border border-green/60 bg-ink/90 px-4 py-2 text-xs text-green backdrop-blur"
          >
            A locked player was scanned free.
          </div>
        )}
        {g.notice && (
          <div
            key={`notice-${g.notice.id}`}
            className="animate-toast-in rounded-xl border border-yellow/60 bg-ink/90 px-4 py-2 text-xs text-yellow backdrop-blur"
          >
            {g.notice.text}
          </div>
        )}
        {g.exitNotice && (
          <div
            key={`exit-${g.exitNotice.id}`}
            className="animate-toast-in rounded-xl border border-yellow/60 bg-ink/90 px-4 py-2 text-xs text-yellow backdrop-blur"
          >
            {g.exitNotice.text}
          </div>
        )}
        {g.playerLeft && (
          <div
            key={`left-${g.playerLeft.id ?? 0}`}
            className="animate-toast-in rounded-xl border border-edge bg-ink/90 px-4 py-2 text-xs text-dim backdrop-blur"
          >
            {g.playerLeft.message}
          </div>
        )}
      </div>

      {/* status overlays */}
      {me?.locked && g.status === "running" && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 text-center">
          <p className="inline-block rounded-2xl border border-red/60 bg-ink/90 px-6 py-3 text-sm text-red backdrop-blur">
            You are locked in. A teammate can lead you out, or two teammates in or beside this room can scan you free.
          </p>
        </div>
      )}

      {isLobby && !g.error && g.connected && g.you && (
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
              Spawn in C3. Find the hidden exit and bring every living player into it. 25 points each.
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
              {g.status === "won" ? "Every living player reached the exit." : lossHeadline(g.gameOver?.reason_code)}
            </h2>
            <p className="mt-2 text-xs uppercase tracking-[0.14em] text-red">
              {g.gameOver?.reason ?? ""}
            </p>
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

      {ghost && (
        <div className="pointer-events-none absolute inset-x-0 top-28 z-30 flex justify-center px-3 sm:top-32">
          <p className="rounded-full border border-red/60 bg-ink/90 px-4 py-2 text-center text-[11px] text-red backdrop-blur">
            GHOST MODE · notes and role intel remain live · movement, doors and puzzles are disabled
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
