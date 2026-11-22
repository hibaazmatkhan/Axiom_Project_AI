import Link from "next/link";
import BroadcastBoard from "@/components/BroadcastBoard";
import PageShell from "@/components/PageShell";
import { BroadcastKicker, SuitMark } from "@/components/Brand";

const STATS = [
  ["04", "Players"],
  ["5×5", "Moving rooms"],
  ["25", "Starting points"],
  ["07", "Stages"],
];

const TICKER = [
  "THE DEALER IS WATCHING",
  "FOUR PLAYERS ENTER",
  "EVERY DOOR IS A CHOICE",
  "THE GRID MOVES EVERY ROUND",
  "PREDICT THE SHIFT",
  "FIND THE HIDDEN EXIT",
];

const LOOP = [
  ["01", "Roll", "Four coloured d10s secretly seal some doorways."],
  ["02", "Cross", "Both rooms must open the same side. Opening costs a point; crossing is free."],
  ["03", "Read", "Each role sees a different slice of the truth."],
  ["04", "Predict", "Call the next shift. Correct calls delay the arena."],
];

const ROLES = [
  {
    name: "Pathfinder",
    suit: "\u2660",
    tag: "Scan",
    tone: "text-blue",
    border: "group-hover:border-blue/50",
    desc: "Reveals the wristband map once per shift to read blocked walls and sanction rooms.",
  },
  {
    name: "Watcher",
    suit: "\u2665",
    tag: "Warning",
    tone: "text-red",
    border: "group-hover:border-red/50",
    desc: "Sees the full KING OF SPADES schedule, including every appearance and teleport room.",
  },
  {
    name: "Timekeeper",
    suit: "\u2666",
    tag: "Clock",
    tone: "text-yellow",
    border: "group-hover:border-yellow/50",
    desc: "Sees the countdown alone and passes the delay puzzle key to the Decoder.",
  },
  {
    name: "Decoder",
    suit: "\u2663",
    tag: "Puzzle",
    tone: "text-green",
    border: "group-hover:border-green/50",
    desc: "Sees the delay puzzle question and solves it with the Timekeeper's key.",
  },
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
  ["01", "Induction", "Learn the room, the coloured doors and the d10 pedestal."],
  ["02", "First Shift", "The grid moves. Re-read the wristband every round."],
  ["03", "Split", "Capacity forces the team apart. Communication becomes survival."],
  ["04", "Visions", "LED walls show possible futures. Predict before committing."],
  ["05", "Lockdown", "The Dealer reacts to the team and seals doors."],
  ["06", "Convergence", "Several rules interact and the grid becomes hard to read."],
  ["07", "The Last Room", "Find the hidden exit and bring every living player into it."],
];

function SectionHeading({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy?: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="mono text-[10px] uppercase tracking-[0.38em] text-gold">{eyebrow}</p>
      <h2 className="mt-3 font-display text-4xl uppercase leading-[0.95] tracking-[0.04em] text-bone sm:text-5xl">
        {title}
      </h2>
      {copy && <p className="mt-4 text-sm leading-relaxed text-dim">{copy}</p>}
    </div>
  );
}

export default function Landing() {
  return (
    <PageShell>
      <main>
        <section className="relative mx-auto grid max-w-7xl gap-12 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.04fr_0.96fr] lg:items-center lg:pb-24 lg:pt-20">
          <div className="relative z-10 animate-rise">
            <BroadcastKicker tone="red">
              <span className="signal-dot" />
              Live broadcast · Round 07
            </BroadcastKicker>

            <h1 className="mt-7 font-display text-[4.5rem] uppercase leading-[0.82] tracking-[0.015em] text-bone sm:text-[6rem] lg:text-[8.2rem]">
              The Last
              <span className="block text-red red-glow">Room</span>
            </h1>

            <p className="mono mt-6 text-[10px] uppercase tracking-[0.42em] text-gold/90">
              Alice in Borderland · A game of possible futures
            </p>

            <p className="mt-6 max-w-xl text-sm leading-relaxed text-dim sm:text-base">
              Four players wake inside a five-by-five matrix of white cube rooms. Every door is
              coloured. Every room can move. Read the broadcast, trust your role, and find the hidden
              exit before the points run out.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/lobby"
                className="group inline-flex items-center gap-3 border border-gold bg-gold px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-void transition hover:bg-bone hover:border-bone focus-ring"
              >
                Enter the arena
                <span className="transition group-hover:translate-x-1">→</span>
              </Link>
              <Link
                href="/login?mode=signup"
                className="inline-flex items-center border border-bone/20 bg-bone/[0.03] px-6 py-3 text-sm font-medium uppercase tracking-[0.16em] text-bone transition hover:border-neon/60 hover:text-neon focus-ring"
              >
                Create account
              </Link>
            </div>

            <div className="mt-9 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STATS.map(([value, label]) => (
                <div key={label} className="border border-bone/10 bg-bone/[0.025] px-3 py-3">
                  <div className="font-display text-2xl leading-none text-gold">{value}</div>
                  <div className="mono mt-1 text-[9px] uppercase tracking-[0.2em] text-dim">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative animate-rise">
            <div className="pointer-events-none absolute -inset-8 rounded-full bg-red/10 blur-[90px]" />
            <SuitMark
              className="pointer-events-none absolute -right-2 -top-10 hidden text-6xl text-red/25 suit-float sm:block"
              animated
            />

            <div className="broadcast-panel panel-cut relative overflow-hidden p-3 sm:p-4">
              <div className="flex items-center justify-between gap-4 border-b border-bone/10 pb-3">
                <span className="mono flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-red">
                  <span className="signal-dot" />
                  Arena feed
                </span>
                <span className="mono text-[10px] uppercase tracking-[0.24em] text-dim">
                  5×5 · live
                </span>
              </div>

              <div className="relative mt-3 aspect-square overflow-hidden border border-bone/10 bg-void">
                <BroadcastBoard />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-void via-transparent to-void/25" />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px animate-scan bg-gradient-to-r from-transparent via-gold to-transparent" />
                <div className="absolute left-3 top-3 border border-red/40 bg-void/80 px-2 py-1">
                  <span className="mono text-[9px] uppercase tracking-[0.2em] text-red">Rec</span>
                </div>
                <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
                  <div className="border border-bone/15 bg-void/85 px-3 py-2 backdrop-blur">
                    <div className="mono text-[9px] uppercase tracking-[0.22em] text-dim">
                      You · C3
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                      <span className="mono text-xs text-bone">25 pts</span>
                    </div>
                  </div>
                  <div className="border border-gold/40 bg-gold/10 px-3 py-2 text-right">
                    <div className="mono text-[9px] uppercase tracking-[0.22em] text-gold/80">
                      Exit
                    </div>
                    <div className="mono mt-1 text-xs text-gold">location unknown</div>
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {[
                  ["Door", "Blue"],
                  ["Shift", "07.4s"],
                  ["Team", "4/4"],
                ].map(([label, value]) => (
                  <div key={label} className="border border-bone/10 bg-bone/[0.025] px-2 py-2">
                    <div className="mono text-[8px] uppercase tracking-[0.22em] text-dim">{label}</div>
                    <div className="mono mt-1 text-[11px] text-bone">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="ticker relative z-10">
          <div className="ticker-track">
            {[0, 1].map((copy) => (
              <div
                key={copy}
                className="ticker-segment"
                aria-hidden={copy === 1 ? true : undefined}
              >
                {TICKER.map((item) => (
                  <span key={`${copy}-${item}`} className="flex items-center gap-4">
                    <span className="mono text-[10px] uppercase tracking-[0.28em] text-dim">
                      {item}
                    </span>
                    <span className="text-[8px] text-gold">◆</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
          <SectionHeading
            eyebrow="The loop"
            title="Four moves. No safe door."
            copy="The arena is server-authoritative and every intent is validated. Points are life, time is pressure, and the grid never stays still."
          />
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {LOOP.map(([number, title, description]) => (
              <article
                key={number}
                className="group relative border border-bone/10 bg-bone/[0.025] p-5 transition hover:-translate-y-1 hover:border-gold/40 hover:bg-bone/[0.045]"
              >
                <div className="font-display text-3xl leading-none text-gold/80">{number}</div>
                <h3 className="mt-5 text-lg font-semibold text-bone">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-dim">{description}</p>
                <span className="absolute bottom-0 left-0 h-px w-0 bg-gold transition-all duration-500 group-hover:w-full" />
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-bone/10 bg-coal/50">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <SectionHeading
                eyebrow="Four roles · one truth"
                title="You cannot see the whole game."
                copy="Information is asymmetric by design. The Pathfinder scans the wristband, the Watcher warns of the KING, the Timekeeper holds the clock and key, and the Decoder answers the delay puzzle."
              />
              <p className="mono max-w-xs text-[10px] uppercase leading-relaxed tracking-[0.2em] text-ash">
                Every role receives a different server-filtered slice. No client can see the hidden
                rule.
              </p>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ROLES.map((role) => (
                <article
                  key={role.name}
                  className={`group border border-bone/10 bg-void/50 p-5 transition hover:-translate-y-1 ${role.border}`}
                >
                  <div className={`font-display text-5xl leading-none ${role.tone}`}>{role.suit}</div>
                  <div className="mono mt-5 text-[9px] uppercase tracking-[0.3em] text-ash">
                    {role.tag}
                  </div>
                  <h3 className={`mt-1 text-lg font-semibold ${role.tone}`}>{role.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-dim">{role.desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
          <SectionHeading
            eyebrow="Seven transformations"
            title="The room is the enemy."
            copy="Rules are data, not code. Each stage introduces fresh transformations and combines them into patterns the team has to recognise before the next shift."
          />
          <div className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {PATTERNS.map(([name, description, tone]) => (
              <div
                key={name}
                className="border border-bone/[0.08] bg-bone/[0.02] px-4 py-4 transition hover:border-bone/25 hover:bg-bone/[0.04]"
              >
                <h3 className={`text-sm font-semibold ${tone}`}>{name}</h3>
                <p className="mt-1 text-xs leading-relaxed text-dim">{description}</p>
              </div>
            ))}
            <div className="border border-dashed border-bone/15 px-4 py-4 text-xs leading-relaxed text-ash">
              New transformation types can be added without touching the game engine.
            </div>
          </div>
        </section>

        <section className="border-y border-bone/10 bg-coal/50">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-24">
            <div>
              <SectionHeading
                eyebrow="Seven stages"
                title="From induction to the last room."
                copy="The Dealer watches how the team learns, then changes the arena in response. The broadcast moves from simple pattern recognition to compound rules and lockdowns."
              />
              <Link
                href="/lobby"
                className="mt-7 inline-flex items-center gap-2 border-b border-gold/40 pb-1 text-sm uppercase tracking-[0.18em] text-gold transition hover:border-gold"
              >
                Start the broadcast <span>→</span>
              </Link>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {STAGES.map(([number, name, description]) => (
                <div
                  key={number}
                  className="group flex gap-4 border border-bone/10 bg-void/60 p-4 transition hover:border-gold/35"
                >
                  <span className="mono flex h-9 w-9 shrink-0 items-center justify-center border border-bone/15 text-xs text-gold transition group-hover:border-gold/50">
                    {number}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-bone">{name}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-dim">{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="broadcast-panel panel-cut relative overflow-hidden p-6 sm:p-9">
              <BroadcastKicker tone="neon">The Dealer · NEXUS</BroadcastKicker>
              <blockquote className="mt-6 font-display text-3xl uppercase leading-[1.02] tracking-[0.03em] text-bone sm:text-4xl">
                “The arena does not get harder. It gets more honest.”
              </blockquote>
              <p className="mt-5 max-w-xl text-sm leading-relaxed text-dim">
                A six-attribute player model, k-means clustering and utility-based adaptation let
                The Dealer choose between raising complexity, adding hazards, giving clues, lowering
                dice or shifting information.
              </p>
              <div className="mt-7 flex flex-wrap gap-2">
                {["A* search", "CSP", "k-means", "Utility AI", "Pattern engine"].map((tag) => (
                  <span
                    key={tag}
                    className="mono border border-bone/15 bg-bone/[0.03] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-dim"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid gap-3">
              {[
                ["Team skill", "82%", "from-blue to-neon"],
                ["Arena pressure", "64%", "from-green via-yellow to-red"],
                ["Rule complexity", "71%", "from-yellow to-gold"],
              ].map(([label, value, tone]) => (
                <div key={label} className="border border-bone/10 bg-bone/[0.025] p-5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="mono text-[10px] uppercase tracking-[0.22em] text-dim">
                      {label}
                    </span>
                    <span className="mono text-sm text-bone">{value}</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden bg-bone/10">
                    <div
                      className={`h-full bg-gradient-to-r ${tone}`}
                      style={{ width: value.replace("%", "") + "%" }}
                    />
                  </div>
                </div>
              ))}
              <div className="border border-gold/30 bg-gold/[0.05] p-5">
                <div className="mono text-[10px] uppercase tracking-[0.22em] text-gold">
                  Next action
                </div>
                <p className="mt-2 text-sm text-bone">
                  Shift information. The team is solving patterns faster than it is coordinating.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="relative mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:pb-28">
          <div className="relative overflow-hidden border border-gold/35 bg-gold/[0.04] px-6 py-12 text-center sm:px-10 sm:py-16">
            <SuitMark className="pointer-events-none absolute -left-4 -top-6 text-7xl text-gold/10" />
            <SuitMark className="pointer-events-none absolute -bottom-7 -right-3 text-7xl text-red/10" />
            <p className="mono text-[10px] uppercase tracking-[0.4em] text-gold">
              The broadcast is live
            </p>
            <h2 className="mx-auto mt-4 max-w-3xl font-display text-5xl uppercase leading-[0.9] tracking-[0.03em] text-bone sm:text-6xl">
              Four players. One hidden exit.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-dim">
              Assemble your team, choose a role, and find out what the room has planned for you.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link
                href="/lobby"
                className="border border-gold bg-gold px-7 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-void transition hover:bg-bone hover:border-bone focus-ring"
              >
                Enter the Last Room
              </Link>
              <Link
                href="/login?mode=signup"
                className="border border-bone/20 px-7 py-3 text-sm font-medium uppercase tracking-[0.16em] text-bone transition hover:border-neon/60 hover:text-neon focus-ring"
              >
                Create your account
              </Link>
            </div>
          </div>
        </section>
      </main>
    </PageShell>
  );
}
