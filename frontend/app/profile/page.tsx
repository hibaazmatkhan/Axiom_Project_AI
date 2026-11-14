"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, auth } from "@/lib/api";

const ATTR_LABELS: Record<string, string> = {
  exploration: "Exploration",
  risk: "Risk",
  cooperation: "Cooperation",
  pattern: "Pattern skill",
  puzzle: "Puzzle skill",
  leadership: "Leadership",
};

export default function ProfilePage() {
  const [user, setUser] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [leaders, setLeaders] = useState<any[]>([]);

  useEffect(() => {
    const u = auth.current();
    setUser(u);
    if (!u) return;
    api.profile(u).then(setStats);
    api.history(u).then((h) => setHistory(h?.matches ?? []));
    api.leaderboard().then((l) => setLeaders(l?.leaders ?? []));
  }, []);

  if (!user) {
    return (
      <main className="relative flex min-h-screen items-center justify-center bg-paper px-4 text-ink">
        <div className="pointer-events-none absolute inset-0 grid-backdrop" />
        <div className="glass relative z-10 rounded-3xl p-8 text-center">
          <p className="text-ink/60">You are not signed in.</p>
          <Link href="/login" className="mt-4 inline-block rounded-xl bg-ink px-5 py-2 font-medium text-paper">
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  const attrs = stats?.attributes ?? {};

  return (
    <main className="relative min-h-screen overflow-hidden bg-paper px-4 py-10 text-ink">
      <div className="pointer-events-none absolute inset-0 grid-backdrop" />
      <div className="relative z-10 mx-auto max-w-5xl animate-rise">
        <div className="flex items-center justify-between">
          <Link href="/lobby" className="mono text-xs tracking-[0.3em] text-ink/50 transition hover:text-ink">
            ← AXIOM · THE LAST ROOM
          </Link>
          <button
            onClick={() => { auth.clear(); location.href = "/"; }}
            className="text-xs text-ink/50 transition hover:text-red"
          >
            Sign out
          </button>
        </div>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">{user}</h1>
            <p className="mt-1 text-ink/60">
              {stats?.style ? `Play style: ${stats.style}` : "No matches recorded yet"}
            </p>
          </div>
          <div className="flex gap-3">
            {[
              ["Matches", stats?.matches ?? 0],
              ["Escapes", stats?.escapes ?? 0],
              ["Accuracy", `${Math.round((stats?.accuracy ?? 0) * 100)}%`],
            ].map(([k, v]) => (
              <div key={k as string} className="glass rounded-2xl px-5 py-3 text-center">
                <div className="mono text-2xl text-blue">{v}</div>
                <div className="text-xs text-ink/50">{k}</div>
              </div>
            ))}
          </div>
        </div>

        <section className="mt-10">
          <h2 className="text-sm font-medium uppercase tracking-[0.3em] text-ink/50">The Dealer's player model</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.keys(ATTR_LABELS).map((k) => {
              const v = Math.round((attrs[k] ?? 0) * 100);
              return (
                <div key={k} className="glass rounded-2xl p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink/60">{ATTR_LABELS[k]}</span>
                    <span className="mono text-ink">{v}%</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue via-yellow to-green transition-all"
                      style={{ width: `${v}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="text-sm font-medium uppercase tracking-[0.3em] text-ink/50">Match history</h2>
            <div className="mt-4 space-y-2">
              {history.length === 0 && <p className="text-sm text-ink/60">No matches yet. Play a round to populate this.</p>}
              {history.map((m) => (
                <div key={m.id} className="glass flex items-center justify-between rounded-2xl p-4 text-sm">
                  <div>
                    <div className="mono text-ink">{m.room}</div>
                    <div className="text-xs text-ink/50">
                      {m.cycles} rounds · {Math.round(m.duration)}s · skill {Math.round((m.team_skill ?? 0) * 100)}%
                    </div>
                  </div>
                  <span className={`text-xs ${m.winner ? "text-green" : "text-ink/50"}`}>
                    {m.winner ? "escaped" : "trapped"}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-medium uppercase tracking-[0.3em] text-ink/50">Leaderboard</h2>
            <div className="mt-4 space-y-2">
              {leaders.length === 0 && <p className="text-sm text-ink/60">No ranked players yet.</p>}
              {leaders.map((l, i) => (
                <div key={l.username} className="glass flex items-center gap-4 rounded-2xl p-4 text-sm">
                  <span className="mono w-6 text-blue">{i + 1}</span>
                  <span className="flex-1">{l.username}</span>
                  <span className="text-xs text-ink/50">{l.matches} matches</span>
                  <span className="mono text-xs text-green">{Math.round((l.pattern ?? 0) * 100)}%</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
