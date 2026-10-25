"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";

function MiniMaze() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const N = 9;
    const cell = c.width / N;
    let cells = Array.from({ length: N }, () => Array.from({ length: N }, () => Math.random() > 0.7));
    let t = 0;
    let raf = 0;
    const draw = () => {
      t++;
      if (t % 70 === 0) {
        const sym = Math.floor(Math.random() * 3);
        cells = cells.map((row, y) =>
          row.map((v, x) => (x % 3 === sym || (x + y) % 4 === sym ? Math.random() > 0.5 : v))
        );
      }
      ctx.clearRect(0, 0, c.width, c.height);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          if (!cells[y][x]) continue;
          const glow = (Math.sin((x + y + t / 20)) + 1) / 2;
          ctx.fillStyle = `rgba(${40 + glow * 40}, ${110 + glow * 120}, ${200 + glow * 55}, ${0.35 + glow * 0.4})`;
          ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} width={320} height={320} className="h-full w-full" />;
}

const PATTERNS = [
  { name: "Rotation", d: "Blocks spin 90° in place.", c: "text-cir" },
  { name: "Reflection", d: "The pattern mirrors across an axis.", c: "text-sqr" },
  { name: "Translation", d: "Openings shift to neighbouring blocks.", c: "text-tri" },
  { name: "Symbol", d: "Only blocks with a given symbol obey.", c: "text-ok" },
  { name: "Sequential", d: "A schedule cycles one symbol at a time.", c: "text-cir" },
  { name: "Conditional", d: "It fires only on some transitions.", c: "text-sqr" },
  { name: "Compound", d: "Two transformations chain in one step.", c: "text-tri" },
];

const STAGES = [
  ["1", "Introduction", "Learn movement and interaction."],
  ["2", "First Pattern", "The first hidden rule appears."],
  ["3", "Cooperation", "Each role sees a different piece."],
  ["4", "Prediction", "Call the next maze state."],
  ["5", "Adaptive Labyrinth", "NEXUS reacts to your team."],
  ["6", "Complex Patterns", "Rules interact and deepen."],
  ["7", "Escape", "Combine everything and break out."],
];

export default function Landing() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-void text-bone">
      <div className="pointer-events-none absolute inset-0 grid-backdrop" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-cir/10 blur-[120px]" />

      <nav className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-edge bg-panel text-cir shadow-glow">
            ◆
          </span>
          <span className="text-lg font-semibold tracking-[0.3em]">AXIOM</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href="/login" className="rounded-lg px-4 py-2 text-dim transition hover:text-bone">
            Sign in
          </Link>
          <Link
            href="/lobby"
            className="rounded-lg bg-cir px-4 py-2 font-medium text-void transition hover:brightness-110"
          >
            Play now
          </Link>
        </div>
      </nav>

      <section className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-10 md:grid-cols-2">
        <div className="animate-rise">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-edge bg-panel/60 px-3 py-1 text-xs tracking-wide text-dim">
            <span className="h-1.5 w-1.5 animate-pulse-glow rounded-full bg-cir" />
            AI-driven multiplayer dynamic labyrinth
          </p>
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
            The maze has a pattern.
            <br />
            <span className="bg-gradient-to-r from-cir via-sqr to-tri bg-clip-text text-transparent">
              Find it before it changes.
            </span>
          </h1>
          <p className="mt-6 max-w-lg text-dim">
            Four players share a labyrinth that rearranges itself by hidden, discoverable rules.
            Observe. Hypothesise. Predict. While an AI director called <span className="text-bone">NEXUS</span>{" "}
            studies your team and adapts the maze around you.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/lobby"
              className="rounded-xl bg-bone px-6 py-3 font-semibold text-void shadow-card transition hover:translate-y-[-1px]"
            >
              Enter the labyrinth
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-edge px-6 py-3 font-medium text-bone transition hover:border-cir"
            >
              Create account
            </Link>
          </div>
          <p className="mt-6 text-xs text-dim">
            Players learn the maze → NEXUS learns the players → the maze evolves → players adapt again.
          </p>
        </div>

        <div className="relative animate-rise">
          <div className="glass relative aspect-square w-full overflow-hidden rounded-3xl p-4 shadow-card">
            <div className="absolute inset-0 opacity-90">
              <MiniMaze />
            </div>
            <div className="absolute inset-x-0 top-0 h-px animate-scan bg-gradient-to-r from-transparent via-cir to-transparent" />
            <div className="absolute bottom-4 left-4 rounded-lg border border-edge bg-void/80 px-3 py-2 text-xs">
              <span className="text-dim">cycle</span>{" "}
              <span className="mono text-cir">{Math.floor(Math.random() * 40 + 12)}</span>
              <span className="ml-3 text-dim">rule</span> <span className="mono text-tri">symbol</span>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-sm font-medium uppercase tracking-[0.3em] text-dim">How it works</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Observe", "Watch the blocks and symbols shift between cycles."],
            ["Recognise", "Form a hypothesis about the hidden rule."],
            ["Predict", "Submit the next state before the timer ends."],
            ["Adapt", "NEXUS changes the maze based on how you play."],
          ].map(([t, d], i) => (
            <div key={t} className="glass rounded-2xl p-5">
              <div className="mono text-cir">{String(i + 1).padStart(2, "0")}</div>
              <h3 className="mt-3 font-semibold">{t}</h3>
              <p className="mt-1 text-sm text-dim">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-sm font-medium uppercase tracking-[0.3em] text-dim">
          Seven transformation types
        </h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PATTERNS.map((p) => (
            <div key={p.name} className="rounded-2xl border border-edge bg-panel/50 p-5 transition hover:border-cir/60">
              <h3 className={`font-semibold ${p.c}`}>{p.name}</h3>
              <p className="mt-1 text-sm text-dim">{p.d}</p>
            </div>
          ))}
          <div className="rounded-2xl border border-dashed border-edge p-5 text-sm text-dim">
            Rules are data, not code. New patterns drop in without touching the engine.
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <div className="flex items-end justify-between">
          <h2 className="text-sm font-medium uppercase tracking-[0.3em] text-dim">Seven stages</h2>
          <span className="text-xs text-dim">from tutorial to escape</span>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {STAGES.map(([n, name, d]) => (
            <div key={n} className="flex items-center gap-4 rounded-2xl border border-edge bg-panel/40 p-4">
              <span className="mono grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-edge bg-void text-cir">
                {n}
              </span>
              <div>
                <h3 className="font-medium">{name}</h3>
                <p className="text-sm text-dim">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="relative z-10 border-t border-edge/60 px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-dim sm:flex-row">
          <span>AXIOM — AI-Driven Multiplayer Dynamic Labyrinth</span>
          <span className="mono">FastAPI · WebSockets · Three.js · Next.js · NEXUS</span>
        </div>
      </footer>
    </main>
  );
}
