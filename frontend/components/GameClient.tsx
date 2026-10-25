"use client";
import { useEffect, useRef, useState } from "react";
import GameCanvas from "./GameCanvas";
import { useGameSocket } from "@/lib/useGameSocket";

const KEYS: Record<string, [number, number]> = {
  w: [0, -1], arrowup: [0, -1],
  s: [0, 1], arrowdown: [0, 1],
  a: [-1, 0], arrowleft: [-1, 0],
  d: [1, 0], arrowright: [1, 0],
};

const PATTERN_TYPES = ["rotation", "reflection", "translation", "symbol", "sequential", "conditional", "compound"];
const SYMBOLS = ["triangle", "circle", "square"];

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`glass rounded-2xl p-4 ${className}`}>{children}</section>;
}

function Stat({ label, value, accent = "text-bone" }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-dim">{label}</span>
      <span className={`mono text-sm ${accent}`}>{value}</span>
    </div>
  );
}

export default function GameClient({ room, name }: { room: string; name: string }) {
  const g = useGameSocket(room, name);
  const [notes, setNotes] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [secs, setSecs] = useState<number | null>(null);
  const [guessType, setGuessType] = useState<string>("");
  const [guessSymbols, setGuessSymbols] = useState<string[]>([]);
  const [showNotes, setShowNotes] = useState(true);
  const held = useRef<string[]>([]);
  const { sendMove, sendReady, sendPredict, sendPuzzle, sendChat, sendClue } = g;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (["TEXTAREA", "INPUT"].includes((e.target as HTMLElement)?.tagName)) return;
      const k = e.key.toLowerCase();
      if (!(k in KEYS)) return;
      e.preventDefault();
      if (!held.current.includes(k)) held.current.push(k);
    };
    const up = (e: KeyboardEvent) => {
      held.current = held.current.filter((k) => k !== e.key.toLowerCase());
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    const timer = setInterval(() => {
      const k = held.current[held.current.length - 1];
      if (k) sendMove(KEYS[k][0], KEYS[k][1]);
    }, 110);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      clearInterval(timer);
    };
  }, [sendMove]);

  useEffect(() => {
    if (g.nextAt == null) { setSecs(null); return; }
    const tick = () => setSecs(Math.max(0, (g.nextAt! - performance.now()) / 1000));
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [g.nextAt]);

  const toggleSymbol = (s: string) =>
    setGuessSymbols((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const me = g.players.find((p) => p.id === g.you);
  const difficultyPct = Math.round(((g.nexus.difficulty ?? 0) + 1) / 2 * 100);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-void text-bone">
      <GameCanvas
        maze={g.maze}
        prevMaze={g.prevMaze}
        players={g.players}
        youId={g.you}
        transitionId={g.transition.id}
        moved={g.transition.moved}
        role={g.role}
        stage={g.stage}
        won={g.status === "won"}
      />

      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between p-4">
        <div className="pointer-events-auto flex items-center gap-3">
          <span className="mono rounded-xl border border-edge bg-panel/80 px-3 py-2 text-sm tracking-[0.2em] backdrop-blur">
            {room}
          </span>
          <span className="hidden rounded-xl border border-edge bg-panel/80 px-3 py-2 text-xs text-dim backdrop-blur sm:block">
            Stage <span className="mono text-cir">{g.stage}</span>/{g.maxStage} · {g.stageName}
          </span>
        </div>
        <div className="pointer-events-auto flex items-center gap-3">
          <div className="rounded-xl border border-edge bg-panel/80 px-4 py-2 text-center backdrop-blur">
            <div className="text-[10px] uppercase tracking-widest text-dim">Next change</div>
            <div className={`mono text-lg tabular-nums ${secs != null && secs < 4 ? "text-danger" : "text-bone"}`}>
              {secs == null ? "--" : secs.toFixed(1) + "s"}
            </div>
          </div>
          <button
            onClick={() => setShowNotes((s) => !s)}
            className="rounded-xl border border-edge bg-panel/80 px-3 py-2 text-xs text-dim backdrop-blur transition hover:text-bone"
          >
            {showNotes ? "Hide" : "Notes"}
          </button>
        </div>
      </div>

      {/* left: team + role */}
      <div className="absolute left-4 top-20 z-20 w-64 space-y-3">
        <Panel>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-dim">Your role</span>
            <span className="mono text-sm text-cir">{g.roleLabel}</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-dim">{g.roleHint}</p>
          <div className="mt-3 space-y-1.5">
            <Stat label="Changes" value={g.cycle} />
            <Stat label="Hidden rules" value={g.ruleCount} accent="text-tri" />
            <Stat label="Streak" value={me?.streak ?? 0} accent="text-ok" />
          </div>
        </Panel>

        <Panel>
          <span className="text-xs uppercase tracking-widest text-dim">Team</span>
          <ul className="mt-2 space-y-2">
            {g.players.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-sm">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: p.color }} />
                <span className={p.id === g.you ? "font-semibold" : ""}>{p.name}</span>
                <span className="ml-auto text-[10px] uppercase tracking-wider text-dim">{p.role}</span>
                {p.escaped && <span className="text-xs text-ok">out</span>}
                {!p.connected && <span className="text-xs text-danger">off</span>}
              </li>
            ))}
          </ul>
        </Panel>

        {showNotes && (
          <Panel>
            <span className="text-xs uppercase tracking-widest text-dim">Team notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Only triangles move, and only every third change…"
              className="scroll-thin mt-2 h-28 w-full resize-none rounded-lg border border-edge bg-void/60 p-2 text-xs outline-none focus:border-cir"
            />
            <button
              onClick={() => { sendClue(g.role, notes); setNotes(""); }}
              disabled={!notes.trim()}
              className="mt-2 w-full rounded-lg border border-edge py-1.5 text-xs text-dim transition hover:border-cir hover:text-bone disabled:opacity-40"
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

      {/* right: NEXUS + prediction + puzzle */}
      <div className="absolute right-4 top-20 z-20 w-72 space-y-3">
        <Panel>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-dim">NEXUS</span>
            <span className="h-2 w-2 animate-pulse-glow rounded-full bg-sqr" />
          </div>
          <p className="mt-2 text-xs italic leading-relaxed text-bone">“{g.nexusMessage}”</p>
          <div className="mt-3 space-y-1.5">
            <Stat label="Team skill" value={`${Math.round((g.nexus.team_skill ?? 0) * 100)}%`} accent="text-cir" />
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-dim">Difficulty</span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-edge/50">
                <div className="h-full rounded-full bg-gradient-to-r from-ok via-tri to-danger" style={{ width: `${difficultyPct}%` }} />
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
          {g.nexus.last_action && (
            <p className="mt-2 text-[10px] text-dim">
              last decision: <span className="text-sqr">{g.nexus.last_action.action}</span>{" "}
              (utility {g.nexus.last_action.utility})
            </p>
          )}
        </Panel>

        <Panel>
          <span className="text-xs uppercase tracking-widest text-dim">Predict next change</span>
          <p className="mt-1 text-[11px] text-dim">Correct calls delay the change. Wrong ones hurry it.</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {PATTERN_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setGuessType((cur) => (cur === t ? "" : t))}
                className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                  guessType === t ? "border-cir bg-cir/15 text-cir" : "border-edge text-dim hover:text-bone"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1">
            {SYMBOLS.map((s) => (
              <button
                key={s}
                onClick={() => toggleSymbol(s)}
                className={`flex-1 rounded-lg border py-1 text-[10px] transition ${
                  guessSymbols.includes(s)
                    ? s === "triangle" ? "border-tri text-tri" : s === "circle" ? "border-cir text-cir" : "border-sqr text-sqr"
                    : "border-edge text-dim hover:text-bone"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            onClick={() => { sendPredict(guessType, guessSymbols); }}
            disabled={!guessType && guessSymbols.length === 0}
            className="mt-3 w-full rounded-lg bg-cir py-2 text-sm font-semibold text-void transition hover:brightness-110 disabled:opacity-40"
          >
            Submit prediction
          </button>
          {g.prediction && (
            <p className={`mt-2 text-xs ${g.prediction.correct ? "text-ok" : "text-danger"}`}>
              {g.prediction.correct ? "Correct" : "Missed"} · {Math.round(g.prediction.score * 100)}% match
            </p>
          )}
        </Panel>

        {g.puzzle && (
          <Panel className="border-tri/50">
            <span className="text-xs uppercase tracking-widest text-tri">Cooperative puzzle</span>
            <p className="mt-2 text-sm">{g.puzzle.question}</p>
            <ul className="mt-2 space-y-1">
              {g.puzzle.clues.map((c, i) => (
                <li key={i} className="rounded-lg bg-void/50 p-2 text-[11px] text-dim">
                  Your clue: {c}
                </li>
              ))}
            </ul>
            <div className="mt-2 grid grid-cols-3 gap-1">
              {g.puzzle.options.map((o, i) => (
                <button
                  key={o}
                  onClick={() => sendPuzzle(i)}
                  className="rounded-lg border border-edge py-1.5 text-xs capitalize transition hover:border-tri hover:text-tri"
                >
                  {o}
                </button>
              ))}
            </div>
            {g.puzzleResult != null && (
              <p className={`mt-2 text-xs ${g.puzzleResult ? "text-ok" : "text-danger"}`}>
                {g.puzzleResult ? "Accepted — waiting for the team" : "Try another answer"}
              </p>
            )}
          </Panel>
        )}
      </div>

      {/* bottom: chat */}
      <div className="absolute bottom-4 left-1/2 z-20 w-[min(560px,90vw)] -translate-x-1/2">
        <div className="glass rounded-2xl p-3">
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
                if (e.key === "Enter" && chatInput.trim()) { sendChat(chatInput); setChatInput(""); }
              }}
              placeholder="Message your team… (W A S D to move)"
              className="flex-1 rounded-lg border border-edge bg-void/60 px-3 py-2 text-sm outline-none focus:border-cir"
            />
            <button
              onClick={() => { if (chatInput.trim()) { sendChat(chatInput); setChatInput(""); } }}
              className="rounded-lg border border-edge px-4 text-sm text-dim transition hover:border-cir hover:text-bone"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {/* overlays */}
      {g.status !== "running" && !g.error && g.connected && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-void/70 backdrop-blur-sm">
          <div className="glass w-80 rounded-3xl p-8 text-center animate-rise">
            {g.status === "won" || g.status === "over" ? (
              <>
                <h2 className="text-2xl font-semibold">
                  {g.status === "won" ? "Everyone escaped." : "The labyrinth won."}
                </h2>
                <p className="mt-2 text-sm text-dim">
                  {g.gameOver?.summary
                    ? `${g.gameOver.summary.cycles} changes · team skill ${Math.round((g.gameOver.summary.team_skill ?? 0) * 100)}%`
                    : ""}
                </p>
                <a href="/profile" className="mt-6 inline-block rounded-xl bg-cir px-6 py-2 font-medium text-void">
                  View profile
                </a>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-semibold">Assembling the team</h2>
                <p className="mt-2 text-sm text-dim">
                  {g.players.filter((p) => p.connected).length} of {g.minPlayers} needed · press Ready
                </p>
                <ul className="mt-4 space-y-2 text-left">
                  {g.players.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 text-sm">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
                      <span>{p.name}</span>
                      <span className="ml-auto text-[10px] uppercase tracking-wider text-dim">{p.role}</span>
                      <span className={`text-xs ${p.ready ? "text-ok" : "text-dim"}`}>
                        {p.ready ? "ready" : "waiting"}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => sendReady(!(me?.ready ?? false))}
                  className={`mt-6 w-full rounded-xl py-3 font-semibold transition ${
                    me?.ready ? "border border-edge text-dim" : "bg-bone text-void hover:brightness-95"
                  }`}
                >
                  {me?.ready ? "Cancel ready" : "Ready up"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {(g.error || !g.connected) && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-void/80">
          <div className="glass rounded-2xl px-6 py-4 text-center">
            {g.error ? (
              <p className="text-danger">{g.error}</p>
            ) : (
              <p className="text-dim">Connecting to the labyrinth…</p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
