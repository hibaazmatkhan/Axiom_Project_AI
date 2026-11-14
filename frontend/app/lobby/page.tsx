"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, auth } from "@/lib/api";

const randomCode = () => Math.random().toString(36).slice(2, 6).toUpperCase();

export default function LobbyPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [user, setUser] = useState<string | null>(null);
  const [health, setHealth] = useState<{ ok: boolean; rooms: number; players: number } | null>(null);

  useEffect(() => {
    const u = auth.current();
    setUser(u);
    if (u) setName(u);
    api.health().then(setHealth);
    const t = setInterval(() => api.health().then(setHealth), 5000);
    return () => clearInterval(t);
  }, []);

  const go = (room: string) => {
    if (!name.trim() || !room.trim()) return;
    router.push(`/game?room=${encodeURIComponent(room.trim().toUpperCase())}&name=${encodeURIComponent(name.trim())}`);
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-paper px-4 text-ink">
      <div className="pointer-events-none absolute inset-0 grid-backdrop" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-blue/10 blur-[110px]" />

      <div className="relative z-10 w-full max-w-lg animate-rise">
        <Link href="/" className="mono text-xs tracking-[0.3em] text-ink/50 transition hover:text-ink">
          ← AXIOM · THE LAST ROOM
        </Link>

        <div className="glass mt-6 rounded-3xl p-6 shadow-card sm:p-8">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-semibold tracking-tight">The Last Room</h1>
            <div className="flex items-center gap-2 text-xs">
              <span className={`h-2 w-2 rounded-full ${health?.ok ? "bg-green animate-pulse-glow" : "bg-red"}`} />
              <span className="text-ink/60">
                {health?.ok ? `${health.players} in ${health.rooms} rooms` : "server offline"}
              </span>
            </div>
          </div>

          <label htmlFor="name" className="mt-6 block text-sm text-ink/60">
            Display name
          </label>
          <input
            id="name"
            value={name}
            maxLength={16}
            onChange={(e) => setName(e.target.value)}
            placeholder="Huzaifa"
            className="mt-1 w-full rounded-xl border border-ink/15 bg-white/70 p-3 outline-none transition focus:border-blue"
          />

          <button
            onClick={() => go(randomCode())}
            disabled={!name.trim()}
            className="mt-4 w-full rounded-xl bg-ink p-3 font-semibold text-paper shadow-card transition hover:brightness-110 disabled:opacity-40"
          >
            Open a room
          </button>

          <div className="my-6 flex items-center gap-3 text-xs text-ink/50">
            <span className="h-px flex-1 bg-ink/10" /> or join an existing room <span className="h-px flex-1 bg-ink/10" />
          </div>

          <label htmlFor="code" className="block text-sm text-ink/60">
            Room code
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="code"
              value={code}
              maxLength={8}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD"
              className="mono w-full rounded-xl border border-ink/15 bg-white/70 p-3 tracking-[0.3em] outline-none transition focus:border-blue"
            />
            <button
              onClick={() => go(code)}
              disabled={!name.trim() || !code.trim()}
              className="rounded-xl border border-ink/15 px-6 font-medium transition hover:border-ink/40 disabled:opacity-40"
            >
              Join
            </button>
          </div>

          <p className="mt-6 text-xs leading-relaxed text-ink/60">
            Rooms hold up to 4 players, one per role: Navigator, Oracle, Timekeeper, Archivist.
            You spawn in C3; the exit is fixed at A5. Open this page in 4 tabs to test locally.
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between px-2 text-sm">
          {user ? (
            <>
              <span className="text-ink/60">
                Signed in as <span className="text-ink">{user}</span>
              </span>
              <Link href="/profile" className="text-blue transition hover:underline">
                View profile →
              </Link>
            </>
          ) : (
            <>
              <span className="text-ink/60">Playing as guest</span>
              <Link href="/login" className="text-blue transition hover:underline">
                Sign in for stats →
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
