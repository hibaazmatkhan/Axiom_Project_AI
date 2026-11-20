"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import Avatar from "@/components/Avatar";
import { BroadcastKicker, SuitMark } from "@/components/Brand";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@/lib/api";
import { characterUrl, loadCharacters, type Character } from "@/lib/characters";
import { guest } from "@/lib/guest";

const randomCode = () => Math.random().toString(36).slice(2, 6).toUpperCase();

const ROLES = [
  ["\u2660", "Navigator", "Grid + shift", "text-blue"],
  ["\u2665", "Oracle", "Sigils + futures", "text-red"],
  ["\u2666", "Timekeeper", "Dice + capacity", "text-yellow"],
  ["\u2663", "Archivist", "Previous arena", "text-green"],
];

const ROLE_PREVIEWS: Record<string, string> = {
  Navigator: "Live grid access: you see every room shift and call the route to A5.",
  Oracle: "Future sight: you read sigils and predicted doors before the round resolves.",
  Timekeeper: "Door math: you track dice rolls, capacity and countdown pressure.",
  Archivist: "Memory access: you keep the previous arena and compare what changed.",
};

export default function LobbyPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [health, setHealth] = useState<{ ok: boolean; rooms: number; players: number } | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
  const [previewRole, setPreviewRole] = useState("Navigator");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setName(guest.get());
      setSelectedCharacter(guest.getAvatar().character_id ?? null);
      setAvatarUrl(null);
      return;
    }
    const fallback = user.displayName || user.email?.split("@")[0] || "";
    setName(fallback);
    api
      .me()
      .then((result) => {
        setName(result.profile.username || fallback);
        setSelectedCharacter(result.profile.character_id ?? null);
        setAvatarUrl(result.profile.avatar_url ?? null);
      })
      .catch(() => undefined);
  }, [user, loading]);

  useEffect(() => {
    void loadCharacters().then(setCharacters);
  }, []);

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

  const chooseCharacter = async (id: string) => {
    if (avatarBusy) return;
    setAvatarError(null);
    if (!user) {
      guest.setAvatar({ character_id: id, avatar_url: characterUrl(id) });
      setSelectedCharacter(id);
      setAvatarUrl(null);
      return;
    }
    setAvatarBusy(true);
    try {
      const result = await api.selectAvatar(id);
      setSelectedCharacter(result.profile.character_id ?? id);
      setAvatarUrl(result.profile.avatar_url ?? characterUrl(id));
    } catch (cause) {
      setAvatarError(cause instanceof Error ? cause.message : "Could not save that avatar.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const uploadPfp = async (file: File | undefined) => {
    if (!file || !user || avatarBusy) return;
    if (file.size > 500 * 1024) {
      setAvatarError("Avatar images must be under 500 KB.");
      return;
    }
    setAvatarBusy(true);
    setAvatarError(null);
    try {
      const result = await api.uploadAvatar(file);
      setAvatarUrl(result.profile.avatar_url ?? null);
      setSelectedCharacter(result.profile.character_id ?? null);
    } catch (cause) {
      setAvatarError(cause instanceof Error ? cause.message : "Could not upload that avatar.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const go = (room: string) => {
    if (!name.trim() || !room.trim()) return;
    if (!user) guest.set(name.trim());
    router.push(
      `/game?room=${encodeURIComponent(room.trim().toUpperCase())}&name=${encodeURIComponent(name.trim())}`
    );
  };

  const displayName = user?.displayName || user?.email?.split("@")[0] || "player";

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
              Open a new arena or enter a friend's code. Four players, four roles. The match begins
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
                  src={avatarUrl ?? (selectedCharacter ? characterUrl(selectedCharacter) : null)}
                  name={name || displayName}
                  characterId={selectedCharacter}
                  size={48}
                />
                <div>
                  <p className="mono text-[10px] uppercase tracking-[0.2em] text-gold">
                    Broadcast face
                  </p>
                  <p className="mt-1 text-xs text-dim">
                    {selectedCharacter ? "Character avatar selected." : "Using initials until you choose."}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {characters.map((character) => (
                  <button
                    key={character.id}
                    type="button"
                    disabled={avatarBusy}
                    onClick={() => chooseCharacter(character.id)}
                    title={character.name}
                    aria-label={`Choose ${character.name} avatar`}
                    className={`border p-1 transition disabled:opacity-40 ${
                      selectedCharacter === character.id
                        ? "border-gold bg-gold/10"
                        : "border-bone/10 hover:border-bone/30"
                    }`}
                  >
                    <Avatar
                      src={characterUrl(character.id)}
                      name={character.name}
                      characterId={character.id}
                      size={34}
                      showSuit={false}
                    />
                  </button>
                ))}
              </div>
              {user ? (
                <label className="mt-3 inline-block cursor-pointer border border-bone/20 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-bone transition hover:border-gold/60 hover:text-gold">
                  {avatarBusy ? "Saving…" : "Upload PFP"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={avatarBusy}
                    onChange={(event) => {
                      void uploadPfp(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </label>
              ) : (
                <p className="mt-3 text-[11px] leading-relaxed text-yellow">
                  Guests can choose a face for this session.{" "}
                  <Link href="/login?next=/lobby" className="underline underline-offset-2 hover:text-bone">
                    Sign in
                  </Link>{" "}
                  to keep it on your profile.
                </p>
              )}
              {avatarError && (
                <p aria-live="polite" className="mt-2 text-[11px] text-red">
                  {avatarError}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => go(randomCode())}
              disabled={!name.trim()}
              className="mt-4 flex w-full items-center justify-between gap-4 border border-gold bg-gold px-5 py-4 text-left text-void transition hover:border-bone hover:bg-bone disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span>
                <span className="block text-sm font-bold uppercase tracking-[0.16em]">
                  Open a new room
                </span>
                <span className="mono mt-1 block text-[9px] uppercase tracking-[0.16em] text-void/60">
                  Create a 4-player broadcast
                </span>
              </span>
              <span className="font-display text-3xl leading-none">→</span>
            </button>

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
                maxLength={8}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === "Enter") go(code);
                }}
                placeholder="ABCD"
                className="mono w-full border border-bone/15 bg-void/70 px-4 py-3 text-sm tracking-[0.35em] text-bone outline-none transition placeholder:text-ash focus:border-neon/70"
              />
              <button
                type="button"
                onClick={() => go(code)}
                disabled={!name.trim() || !code.trim()}
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
                <span className="mono text-[9px] uppercase tracking-[0.16em] text-ash">
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
                  <span>Spawn in C3. The exit is fixed at A5.</span>
                </li>
                <li className="flex gap-3">
                  <span className="mono text-gold">02</span>
                  <span>Every player starts with 15 points. Crossing and waiting cost 1.</span>
                </li>
                <li className="flex gap-3">
                  <span className="mono text-gold">03</span>
                  <span>The grid shifts every round. Read the wristband, not the walls.</span>
                </li>
                <li className="flex gap-3">
                  <span className="mono text-gold">04</span>
                  <span>Reach A5 with every living player and solve the cooperative cipher.</span>
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
