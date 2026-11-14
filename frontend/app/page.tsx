"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";

const DOOR_COLORS = ["#e23b3b", "#3f7bd9", "#e8b53a", "#3f9f6b"];
const SIGILS = ["\u2660", "\u2665", "\u2666", "\u2663"];

function FutureBoard() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const N = 5;
    const cell = c.width / N;
    const makeCell = () => ({
      edges: DOOR_COLORS.slice().sort(() => Math.random() - 0.5),
      sigil: SIGILS[Math.floor(Math.random() * SIGILS.length)],
    });
    let grid = Array.from({ length: N }, () => Array.from({ length: N }, makeCell));
    let t = 0;
    let raf = 0;
    const draw = () => {
      t++;
      if (t % 80 === 0) {
        const row = Math.floor(Math.random() * N);
        const shift = Math.random() > 0.5 ? 1 : -1;
        grid[row] = grid[row].slice().sort(() => shift * (Math.random() - 0.5));
      }
      ctx.clearRect(0, 0, c.width, c.height);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const px = x * cell;
          const py = y * cell;
          const isYou = x === 2 && y === 2;
          const isExit = x === 0 && y === 4;
          ctx.fillStyle = isExit ? "rgba(232,181,58,0.10)" : "rgba(20,22,26,0.025)";
          ctx.fillRect(px + 6, py + 6, cell - 12, cell - 12);
          ctx.strokeStyle = isYou ? "rgba(232,181,58,0.9)" : "rgba(20,22,26,0.14)";
          ctx.lineWidth = isYou ? 2.5 : 1;
          ctx.strokeRect(px + 6, py + 6, cell - 12, cell - 12);

          const e = grid[y][x].edges;
          const pulse = 0.55 + 0.35 * Math.sin(t / 24 + x + y);
          const bars = [
            [px + 12, py + 6, cell - 24, 4, e[0]],
            [px + cell - 10, py + 12, 4, cell - 24, e[1]],
            [px + 12, py + cell - 10, cell - 24, 4, e[2]],
            [px + 6, py + 12, 4, cell - 24, e[3]],
          ] as const;
          for (const [bx, by, bw, bh, color] of bars) {
            ctx.globalAlpha = pulse;
            ctx.fillStyle = color;
            ctx.fillRect(bx, by, bw, bh);
            ctx.globalAlpha = 1;
          }
          ctx.fillStyle = "rgba(20,22,26,0.55)";
          ctx.font = "11px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(grid[y][x].sigil, px + cell / 2, py + cell / 2);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} width={420} height={420} className="h-full w-full" />;
}

const LOOP = [
  ["Roll", "Every room rolls four coloured d10s. The result is this round's door capacity."],
  ["Cross", "Pass a doorway only when both sides are open. Crossing costs a point."],
  ["Read", "Each role sees a different slice: the grid, sigils, dice or the previous arena."],
  ["Predict", "Call the next shift. Correct calls delay the grid; wrong ones hurry it."],
];

const ROLES = [
  ["Navigator", "Sees the grid and exactly which rooms shifted. Calls the route.", "text-blue"],
  ["Oracle", "Sees sigils, door colours and the cleanest possible futures.", "text-yellow"],
  ["Timekeeper", "Sees d10 results and remaining door capacity. Calls the timing.", "text-green"],
  ["Archivist", "Sees the previous grid as a ghost. Compares it with the living one.", "text-red"],
];

const PATTERNS = [
  ["Rotation", "A block of rooms turns ninety degrees in place.", "text-blue"],
  ["Reflection", "A row or column mirrors across an axis.", "text-green"],
  ["Translation", "Rows and columns slide, carrying players with them.", "text-yellow"],
  ["Symbol", "Only rooms carrying a sigil obey the rule.", "text-red"],
  ["Sequential", "A schedule moves one sigil at a time.", "text-blue"],
  ["Conditional", "The rule fires only on certain rounds.", "text-green"],
  ["Compound", "Two transformations chain in a single shift.", "text-yellow"],
];

const STAGES = [
  ["1", "Induction", "Learn the room, the coloured doors and the d10 pedestal."],
  ["2", "First Shift", "The grid moves. Re-read the wristband map every round."],
  ["3", "Split", "Door capacity forces the team apart. Communication is essential."],
  ["4", "Visions", "LED walls show possible futures. Predict before committing."],
  ["5", "Lockdown", "The Dealer reacts to the team and seals doors."],
  ["6", "Convergence", "Several rules interact and the grid becomes hard to read."],
  ["7", "The Last Room", "Reach A5 with every living player and open the final door."],
];

export default function Landing() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-paper text-ink">
      <div className="pointer-events-none absolute inset-0 grid-backdrop" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-yellow/15 blur-[130px]" />

      <nav className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-ink/15 bg-white/70 text-ink shadow-card">
            ◈
          </span>
          <span className="text-lg font-semibold tracking-[0.3em]">AXIOM</span>
          <span className="hidden text-xs tracking-[0.3em] text-ink/50 sm:inline">THE LAST ROOM</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href="/login" className="rounded-lg px-4 py-2 text-ink/60 transition hover:text-ink">
            Sign in
          </Link>
          <Link
            href="/lobby"
            className="rounded-lg bg-ink px-4 py-2 font-medium text-paper transition hover:brightness-110"
          >
            Enter
          </Link>
        </div>
      </nav>

      <section className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-10 md:grid-cols-2">
        <div className="animate-rise">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white/60 px-3 py-1 text-xs tracking-wide text-ink/60">
            <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-red" />
            A four-player game of possible futures
          </p>
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
            Every door is a choice.
            <br />
            <span className="bg-gradient-to-r from-red via-yellow to-green bg-clip-text text-transparent">
              Every room can move.
            </span>
          </h1>
          <p className="mt-6 max-w-lg text-ink/70">
            Four players wake inside a 5×5 matrix of white cube rooms. Each room has four coloured
            doors and a pedestal of four d10s. Cross only when both sides open, spend points to move,
            and read the LED futures on the walls — while an AI director called{" "}
            <span className="font-medium text-ink">The Dealer</span> learns your team and shifts the
            grid beneath you.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/lobby"
              className="rounded-xl bg-ink px-6 py-3 font-semibold text-paper shadow-card transition hover:translate-y-[-1px]"
            >
              Enter the Last Room
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-ink/15 px-6 py-3 font-medium text-ink transition hover:border-ink/40"
            >
              Create account
            </Link>
          </div>
          <p className="mt-6 text-xs text-ink/50">
            15 points. 15 rounds. A team of four. Spawn C3 · exit A5.
          </p>
        </div>

        <div className="relative animate-rise">
          <div className="glass relative aspect-square w-full overflow-hidden rounded-3xl p-4 shadow-card">
            <div className="absolute inset-0 opacity-90">
              <FutureBoard />
            </div>
            <div className="absolute inset-x-0 top-0 h-px animate-scan bg-gradient-to-r from-transparent via-yellow to-transparent" />
            <div className="absolute bottom-4 left-4 rounded-lg border border-ink/10 bg-paper/90 px-3 py-2 text-xs">
              <span className="text-ink/50">round</span>{" "}
              <span className="mono text-ink">07</span>
              <span className="ml-3 text-ink/50">door</span>{" "}
              <span className="mono text-blue">blue</span>
              <span className="ml-3 text-ink/50">points</span>{" "}
              <span className="mono text-ink">09</span>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-sm font-medium uppercase tracking-[0.3em] text-ink/50">The loop</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LOOP.map(([t, d], i) => (
            <div key={t} className="rounded-2xl border border-ink/10 bg-white/60 p-5">
              <div className="mono text-yellow">{String(i + 1).padStart(2, "0")}</div>
              <h3 className="mt-3 font-semibold">{t}</h3>
              <p className="mt-1 text-sm text-ink/60">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-sm font-medium uppercase tracking-[0.3em] text-ink/50">Four roles, one truth</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map(([name, d, c]) => (
            <div key={name} className="rounded-2xl border border-ink/10 bg-white/50 p-5 transition hover:border-ink/25">
              <h3 className={`font-semibold ${c}`}>{name}</h3>
              <p className="mt-1 text-sm text-ink/60">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-sm font-medium uppercase tracking-[0.3em] text-ink/50">
          Seven transformation types
        </h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PATTERNS.map(([name, d, c]) => (
            <div key={name} className="rounded-2xl border border-ink/10 bg-white/40 p-5 transition hover:border-ink/25">
              <h3 className={`font-semibold ${c}`}>{name}</h3>
              <p className="mt-1 text-sm text-ink/60">{d}</p>
            </div>
          ))}
          <div className="rounded-2xl border border-dashed border-ink/20 p-5 text-sm text-ink/50">
            Rules are data, not code. New patterns drop in without touching the engine.
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <div className="flex items-end justify-between">
          <h2 className="text-sm font-medium uppercase tracking-[0.3em] text-ink/50">Seven stages</h2>
          <span className="text-xs text-ink/50">from induction to the last room</span>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {STAGES.map(([n, name, d]) => (
            <div key={n} className="flex items-center gap-4 rounded-2xl border border-ink/10 bg-white/40 p-4">
              <span className="mono grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-ink/15 bg-paper text-ink">
                {n}
              </span>
              <div>
                <h3 className="font-medium">{name}</h3>
                <p className="text-sm text-ink/60">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="relative z-10 border-t border-ink/10 px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-ink/50 sm:flex-row">
          <span>AXIOM · THE LAST ROOM — a game of possible futures</span>
          <span className="mono">FastAPI · WebSockets · Three.js · Next.js · The Dealer</span>
        </div>
      </footer>
    </main>
  );
}
