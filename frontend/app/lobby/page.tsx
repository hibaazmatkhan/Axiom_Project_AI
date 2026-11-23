"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import PageShell from "@/components/PageShell";
import Avatar from "@/components/Avatar";
import { BroadcastKicker, SuitMark } from "@/components/Brand";
import { useAuth } from "@/components/AuthProvider";
import { useProfile } from "@/components/ProfileProvider";
import { ApiError, api, canonicalRoomCode } from "@/lib/api";
import { PFP_PRESETS, pfpPresetUrl, type PfpPresetId } from "@/lib/avatarRules";
import { guest } from "@/lib/guest";

const QUICK_MATCH_KEY = "axiom.quickMatchClientKey";

const ROLES = [
  ["\u2660", "Pathfinder", "Wristband scan", "text-blue"],
  ["\u2665", "Watcher", "KING alert", "text-red"],
  ["\u2666", "Timekeeper", "Countdown + key", "text-yellow"],
  ["\u2663", "Decoder", "Puzzle answer", "text-green"],
];

const ROLE_PREVIEWS: Record<string, string> = {
  Pathfinder: "Wristband scan: reveal blocked walls and sanction rooms until the next shift.",
  Watcher: "Early warning: you see the full KING OF SPADES schedule, including every appearance and teleport room.",
  Timekeeper: "Clock control: you alone see the countdown and pass the delay puzzle key to the Decoder.",
  Decoder: "Puzzle access: you see the delay puzzle question and answer it using the Timekeeper's key.",
};

function clientKey(): string {
  const stored = window.sessionStorage.getItem(QUICK_MATCH_KEY);
  if (stored) return stored;
  const next =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(QUICK_MATCH_KEY, next);
  return next;
}

function retryableRoomLookup(status: number): boolean {
  return status === 0 || status === 404 || status === 410 || status >= 500;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function LobbyPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { data: profileData, refresh: refreshProfile } = useProfile();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [health, setHealth] = useState<{ ok: boolean; rooms: number; players: number; instance_id?: string } | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [previewRole, setPreviewRole] = useState("Pathfinder");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [pfpPresetId, setPfpPresetId] = useState<PfpPresetId>("joker");
  const [profileName, setProfileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quickPosition, setQuickPosition] = useState<number | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickMatchActive = useRef(false);
  const joinInFlight = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setName(guest.get());
      setAvatarUrl(null);
      setPfpPresetId(guest.getPfp());
      setProfileName("");
      return;
    }
    setName(user.displayName || user.email?.split("@")[0] || "");
    void refreshProfile();
  }, [user, loading, refreshProfile]);

  useEffect(() => {
    if (!user || !profileData) return;
    const fallback = user.displayName || user.email?.split("@")[0] || "";
    const nextName = profileData.profile.display_name || profileData.profile.username || fallback;
    setName(nextName);
    setProfileName(nextName);
    setAvatarUrl(profileData.profile.avatar_url ?? null);
  }, [user, profileData]);

  useEffect(() => {
    setHealthLoading(true);
    api
      .health()
      .then((result) => {
        setHealth(result);
        setHealthLoading(false);
      })
      .catch(() => {
        setHealth(null);
        setHealthLoading(false);
      });
    const timer = setInterval(() => api.health().then(setHealth), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      quickMatchActive.current = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    []
  );

  const stopPolling = () => {
    quickMatchActive.current = false;
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const go = (room: string) => {
    const canonical = canonicalRoomCode(room);
    if (!name.trim() || canonical.length !== 4) return;
    if (!user) {
      guest.set(name.trim());
      guest.setPfp(pfpPresetId);
    }
    router.push(
      `/game?room=${encodeURIComponent(canonical)}&name=${encodeURIComponent(name.trim())}`
    );
  };

  const errorMessage = (cause: unknown, fallback: string) =>
    cause instanceof Error ? cause.message : fallback;

  const createRoom = async () => {
    if (!name.trim() || busy) return;
    setError(null);
    stopPolling();
    setBusy(true);
    try {
      const room = await api.createRoom();
      go(room.code);
    } catch (cause) {
      setError(errorMessage(cause, "Could not create a room."));
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async () => {
    const target = canonicalRoomCode(code);
    if (!name.trim() || busy || joinInFlight.current) return;
    if (!/^[A-Z0-9]{4}$/.test(target)) {
      setError("Room codes are exactly four letters or numbers.");
      return;
    }
    setError(null);
    stopPolling();
    joinInFlight.current = true;
    setBusy(true);
    try {
      let room: Awaited<ReturnType<typeof api.getRoom>> | null = null;
      let lookupError: unknown = null;
      let lookupStatus = 0;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          room = await api.getRoom(target);
          break;
        } catch (cause) {
          lookupError = cause;
          lookupStatus = cause instanceof ApiError ? cause.status : 0;
          if (!retryableRoomLookup(lookupStatus) || attempt === 2) break;
          await wait(250 * (attempt + 1));
        }
      }
      if (!room) {
        if (retryableRoomLookup(lookupStatus)) {
          go(target);
          return;
        }
        throw lookupError ?? new Error("That room code is not available.");
      }
      if (room.status !== "lobby" || room.started) {
        throw new Error("That match has already started.");
      }
      if (room.full || room.joinable === false) {
        throw new Error("That room is full.");
      }
      go(target);
    } catch (cause) {
      setError(errorMessage(cause, "That room code is not available."));
    } finally {
      joinInFlight.current = false;
      setBusy(false);
    }
  };

  const pollQuickMatch = async (key: string) => {
    if (!quickMatchActive.current) return;
    try {
      const result = await api.quickMatchStatus(key);
      if (!quickMatchActive.current) return;
      if (result.status === "matched" && result.code) {
        quickMatchActive.current = false;
        setBusy(false);
        go(result.code);
        return;
      }
      setQuickPosition(result.position ?? null);
      pollTimer.current = setTimeout(() => void pollQuickMatch(key), 1200);
    } catch (cause) {
      quickMatchActive.current = false;
      setBusy(false);
      setError(errorMessage(cause, "Quick match is unavailable."));
    }
  };

  const startQuickMatch = async () => {
    if (!name.trim() || busy) return;
    setError(null);
    setQuickPosition(null);
    stopPolling();
    setBusy(true);
    try {
      const key = clientKey();
      const result = await api.quickMatch(key);
      if (result.status === "matched" && result.code) {
        setBusy(false);
        go(result.code);
        return;
      }
      setQuickPosition(result.position ?? null);
      quickMatchActive.current = true;
      pollTimer.current = setTimeout(() => void pollQuickMatch(key), 1200);
    } catch (cause) {
      setBusy(false);
      setError(errorMessage(cause, "Quick match is unavailable."));
    }
  };

  const displayName = profileName || user?.displayName || user?.email?.split("@")[0] || "player";

  return (
    <PageShell>
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-16">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <BroadcastKicker tone="gold">
              <span className="signal-dot" />
              Lobby · Matchmaking
            </BroadcastKicker>
            <h1 className="mt-4 font-display text-5xl uppercase leading-[0.9] tracking-[0.03em] text-bone sm:text-6xl">
              Choose your room.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-dim">
              Open a new arena, queue for the next match or enter a friend's code. The match begins
              when everyone is ready.
            </p>
          </div>

          <div className="flex items-center gap-3 border border-bone/10 bg-bone/[0.025] px-4 py-3">
            <span
              className={`h-2 w-2 rounded-full ${
                health?.ok ? "bg-green shadow-[0_0_12px_rgba(88,214,141,.8)]" : "bg-red"
              }`}
            />
            <div>
              <div className="mono text-[9px] uppercase tracking-[0.22em] text-ash">
                Broadcast status
              </div>
              <div className="mono mt-1 text-xs text-bone">
                {healthLoading
                  ? "Checking signal…"
                  : health?.ok
                    ? `${health.players} in ${health.rooms} room${health.rooms === 1 ? "" : "s"}`
                    : "Server offline"}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
          <section className="broadcast-panel panel-cut relative p-6 sm:p-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="mono text-[10px] uppercase tracking-[0.3em] text-gold">
                  Player terminal
                </p>
                <h2 className="mt-2 text-xl font-semibold text-bone">Enter the arena</h2>
              </div>
              <SuitMark className="text-2xl text-bone/60" />
            </div>

            <label htmlFor="name" className="mono mt-7 block text-[10px] uppercase tracking-[0.2em] text-dim">
              Display name
            </label>
            <input
              id="name"
              value={name}
              maxLength={24}
              autoComplete="nickname"
              onChange={(event) => setName(event.target.value)}
              placeholder="Your broadcast name"
              className="mt-2 w-full border border-bone/15 bg-void/70 px-4 py-3 text-sm text-bone outline-none transition placeholder:text-ash focus:border-gold/70"
            />

            <div className="mt-5 border-t border-bone/10 pt-5">
              <div className="flex items-center gap-3">
                <Avatar
                  src={user ? avatarUrl ?? pfpPresetUrl("joker") : pfpPresetUrl(pfpPresetId)}
                  name={name || displayName}
                  size={48}
                />
                <div>
                  <p className="mono text-[10px] uppercase tracking-[0.2em] text-gold">
                    Broadcast face
                  </p>
                  <p className="mt-1 text-xs text-dim">
                    "Your current profile symbol travels with you into the arena."
                  </p>
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-dim">
                {user ? (
                  <>
                    Profile images are managed in account settings.{" "}
                    <Link href="/profile" className="text-gold underline underline-offset-2 hover:text-bone">
                      Change PFP →
                    </Link>
                  </>
                ) : (
                  <>
                    Guests can pick a temporary symbol below.{" "}
                    <Link href="/login?next=/lobby" className="text-gold underline underline-offset-2 hover:text-bone">
                      Sign in
                    </Link>{" "}
                    to save a profile image.
                  </>
                )}
              </p>
              {!user && (
                <div className="mt-3 flex flex-wrap gap-2" aria-label="Guest profile image">
                  {PFP_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        setPfpPresetId(preset.id);
                        guest.setPfp(preset.id);
                      }}
                      aria-pressed={pfpPresetId === preset.id}
                      title={preset.label}
                      className={`border p-1 transition ${
                        pfpPresetId === preset.id
                          ? "border-gold bg-gold/10"
                          : "border-bone/10 hover:border-bone/30"
                      }`}
                    >
                      <Avatar src={preset.src} name={preset.label} size={34} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void createRoom()}
              disabled={!name.trim() || busy}
              className="mt-4 flex w-full items-center justify-between gap-4 border border-gold bg-gold px-5 py-4 text-left text-void transition hover:border-bone hover:bg-bone disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span>
                <span className="block text-sm font-bold uppercase tracking-[0.16em]">
                  Open a new room
                </span>
                <span className="mono mt-1 block text-[9px] uppercase tracking-[0.16em] text-void/60">
                  Create a broadcast
                </span>
              </span>
              <span className="font-display text-3xl leading-none">→</span>
            </button>

            <button
              type="button"
              onClick={() => void startQuickMatch()}
              disabled={!name.trim() || busy}
              className="mt-2 flex w-full items-center justify-between gap-4 border border-neon/45 bg-neon/[0.06] px-5 py-4 text-left text-bone transition hover:border-neon hover:bg-neon/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span>
                <span className="block text-sm font-bold uppercase tracking-[0.16em]">
                  {quickPosition !== null
                    ? `In queue · position ${quickPosition}`
                    : "Quick match"}
                </span>
                <span className="mono mt-1 block text-[9px] uppercase tracking-[0.16em] text-dim">
                  {quickPosition !== null
                    ? "Waiting for the next player"
                    : "Join the next available room"}
                </span>
              </span>
              <span className="font-display text-3xl leading-none">→</span>
            </button>

            {error && (
              <p className="mt-3 border border-red/35 bg-red/[0.06] p-3 text-xs leading-relaxed text-red">
                {error}
              </p>
            )}

            <div className="my-7 flex items-center gap-3">
              <span className="h-px flex-1 bg-bone/10" />
              <span className="mono text-[9px] uppercase tracking-[0.24em] text-ash">
                or join with a code
              </span>
              <span className="h-px flex-1 bg-bone/10" />
            </div>

            <label htmlFor="code" className="mono block text-[10px] uppercase tracking-[0.2em] text-dim">
              Room code
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="code"
                value={code}
                maxLength={4}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void joinRoom();
                }}
                placeholder="ABCD"
                className="mono w-full border border-bone/15 bg-void/70 px-4 py-3 text-sm tracking-[0.35em] text-bone outline-none transition placeholder:text-ash focus:border-neon/70"
              />
              <button
                type="button"
                onClick={() => void joinRoom()}
                disabled={!name.trim() || !code.trim() || busy}
                className="shrink-0 border border-bone/25 px-6 text-xs font-semibold uppercase tracking-[0.16em] text-bone transition hover:border-neon/60 hover:text-neon disabled:cursor-not-allowed disabled:opacity-40"
              >
                Join
              </button>
            </div>

            {user && !user.emailVerified && (
              <div className="mt-5 border border-yellow/35 bg-yellow/[0.06] p-4 text-xs leading-relaxed text-yellow">
                This account is not verified. You can play, but ranked history and leaderboard
                placement are locked.{" "}
                <Link href="/profile" className="underline underline-offset-2 hover:text-bone">
                  Verify in your dossier
                </Link>
                .
              </div>
            )}

            <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-bone/10 pt-5 text-xs">
              {user ? (
                <>
                  <span className="text-dim">
                    Signed in as <span className="text-bone">{displayName}</span>
                  </span>
                  <Link href="/profile" className="text-gold transition hover:text-bone">
                    View profile →
                  </Link>
                </>
              ) : (
                <>
                  <span className="text-dim">Playing as guest</span>
                  <Link href="/login" className="text-gold transition hover:text-bone">
                    Sign in for stats →
                  </Link>
                </>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <section className="border border-bone/10 bg-bone/[0.025] p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="mono text-[10px] uppercase tracking-[0.28em] text-gold">
                  Role assignment
                </p>
                <span className="mono text-[9px] uppercase tracking-[0.14em] text-ash">
                  1 per player
                </span>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                {ROLES.map(([suit, role, detail, tone]) => (
                  <button
                    type="button"
                    key={role}
                    onClick={() => setPreviewRole(role)}
                    aria-pressed={previewRole === role}
                    className={`flex items-center gap-3 border px-3 py-3 text-left transition ${
                      previewRole === role
                        ? "border-gold bg-gold/[0.06]"
                        : "border-bone/[0.08] bg-void/50 hover:border-bone/20"
                    }`}
                  >
                    <span className={`font-display text-2xl leading-none ${tone}`}>{suit}</span>
                    <div>
                      <div className={`text-sm font-semibold ${tone}`}>{role}</div>
                      <div className="mono text-[9px] uppercase tracking-[0.14em] text-ash">
                        {detail}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-3 border-t border-bone/10 pt-3">
                <p className="mono text-[9px] uppercase tracking-[0.18em] text-gold">
                  {previewRole} preview
                </p>
                <p className="mt-1 text-xs leading-relaxed text-dim">
                  {ROLE_PREVIEWS[previewRole]}
                </p>
              </div>
            </section>

            <section className="border border-bone/10 bg-bone/[0.025] p-5">
              <p className="mono text-[10px] uppercase tracking-[0.28em] text-gold">
                Match briefing
              </p>
              <ul className="mt-4 space-y-3 text-xs leading-relaxed text-dim">
                <li className="flex gap-3">
                  <span className="mono text-gold">01</span>
                  <span>Spawn in C3. The exit is hidden in an edge room.</span>
                </li>
                <li className="flex gap-3">
                  <span className="mono text-gold">02</span>
                  <span>Every player starts with 20 points. Crossing and waiting cost 1.</span>
                </li>
                <li className="flex gap-3">
                  <span className="mono text-gold">03</span>
                  <span>The grid shifts every round. Read the wristband, not the walls.</span>
                </li>
                <li className="flex gap-3">
                  <span className="mono text-gold">04</span>
                  <span>Find the hidden exit and bring every living player into it.</span>
                </li>
              </ul>
            </section>

            <div className="border border-red/25 bg-red/[0.04] p-5">
              <p className="mono text-[10px] uppercase tracking-[0.24em] text-red">Warning</p>
              <p className="mt-2 text-xs leading-relaxed text-dim">
                The Dealer never reveals the hidden rule. Anything you see is a slice of the arena,
                not the whole truth.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </PageShell>
  );
}
