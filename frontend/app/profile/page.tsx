"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import { BroadcastKicker, SuitMark } from "@/components/Brand";
import { useAuth } from "@/components/AuthProvider";
import {
  ApiError,
  api,
  type Leader,
  type MatchRecord,
  type MeResponse,
  type PlayerStats,
} from "@/lib/api";
import { authErrorMessage } from "@/lib/authErrors";
import { getFirebaseAuth } from "@/lib/firebase";
import {
  TotpMultiFactorGenerator,
  multiFactor,
  sendEmailVerification,
  signOut,
  type MultiFactorInfo,
  type TotpSecret,
} from "firebase/auth";

const ATTR_LABELS: Record<string, string> = {
  exploration: "Exploration",
  risk: "Risk",
  cooperation: "Cooperation",
  pattern: "Pattern skill",
  puzzle: "Puzzle skill",
  leadership: "Leadership",
};

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [history, setHistory] = useState<MatchRecord[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDisplay, setEditDisplay] = useState("");
  const [mfaFactors, setMfaFactors] = useState<MultiFactorInfo[]>([]);
  const [mfaSecret, setMfaSecret] = useState<TotpSecret | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);

  const refresh = async () => {
    try {
      const result = await api.me();
      setMe(result);
      setEditName(result.profile.username);
      setEditDisplay(result.profile.display_name);
      setError(null);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Profile storage is not available.";
      setError(message);
    }
  };

  useEffect(() => {
    if (!user) {
      setMe(null);
      setHistory([]);
      return;
    }
    void refresh();
    api
      .leaderboard()
      .then((result) => setLeaders(result.leaders))
      .catch(() => undefined);
    if (user.emailVerified) {
      api
        .history()
        .then((result) => setHistory(result.matches))
        .catch((cause) => {
          if (cause instanceof ApiError && cause.status === 403) {
            setHistory([]);
          }
        });
    } else {
      setHistory([]);
    }
    try {
      setMfaFactors(multiFactor(user).enrolledFactors);
    } catch {
      setMfaFactors([]);
    }
  }, [user]);

  const saveProfile = async () => {
    if (busy || !editName.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.updateProfile({
        username: editName.trim(),
        display_name: editDisplay.trim() || editName.trim(),
      });
      setMe((current) => (current ? { ...current, profile: result.profile } : current));
      setNotice("Profile saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the profile.");
    } finally {
      setBusy(false);
    }
  };

  const resendVerification = async () => {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await sendEmailVerification(user);
      setNotice("Verification email sent. Check your inbox.");
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const startMfa = async () => {
    if (!user || mfaBusy) return;
    setMfaBusy(true);
    setError(null);
    setNotice(null);
    try {
      const session = await multiFactor(user).getSession();
      const secret = await TotpMultiFactorGenerator.generateSecret(session);
      setMfaSecret(secret);
      setMfaCode("");
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setMfaBusy(false);
    }
  };

  const confirmMfa = async () => {
    if (!user || !mfaSecret || mfaBusy) return;
    setMfaBusy(true);
    setError(null);
    setNotice(null);
    try {
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(
        mfaSecret,
        mfaCode.trim()
      );
      await multiFactor(user).enroll(assertion, "AXIOM authenticator");
      await api.setMfa(true).catch(() => undefined);
      setMfaFactors(multiFactor(user).enrolledFactors);
      setMfaSecret(null);
      setMfaCode("");
      setNotice("Authenticator app enrolled. Future sign-ins will ask for a code.");
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setMfaBusy(false);
    }
  };

  const disableMfa = async (factor: MultiFactorInfo) => {
    if (!user || mfaBusy) return;
    setMfaBusy(true);
    setError(null);
    setNotice(null);
    try {
      await multiFactor(user).unenroll(factor);
      await api.setMfa(false).catch(() => undefined);
      setMfaFactors(multiFactor(user).enrolledFactors);
      setMfaSecret(null);
      setNotice("Second factor removed.");
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setMfaBusy(false);
    }
  };

  if (loading) {
    return (
      <PageShell hideFooter>
        <main className="mx-auto flex min-h-[calc(100vh-68px)] max-w-7xl items-center justify-center px-4 py-12 sm:px-6">
          <p className="mono text-xs uppercase tracking-[0.2em] text-ash">Reading dossier…</p>
        </main>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell hideFooter>
        <main className="mx-auto flex min-h-[calc(100vh-68px)] max-w-7xl items-center justify-center px-4 py-12 sm:px-6">
          <section className="broadcast-panel panel-cut relative w-full max-w-lg p-8 text-center">
            <SuitMark className="mx-auto text-3xl text-gold" />
            <h1 className="mt-5 font-display text-4xl uppercase tracking-[0.03em] text-bone">
              No player detected.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-dim">
              Sign in to see your match history, The Dealer's player model and your leaderboard
              position. You can still play as a guest from the lobby.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link
                href="/login"
                className="border border-gold bg-gold px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-void transition hover:border-bone hover:bg-bone"
              >
                Sign in
              </Link>
              <Link
                href="/lobby"
                className="border border-bone/20 px-6 py-3 text-sm font-medium uppercase tracking-[0.16em] text-bone transition hover:border-neon/60 hover:text-neon"
              >
                Play as guest
              </Link>
            </div>
          </section>
        </main>
      </PageShell>
    );
  }

  const profile = me?.profile;
  const stats: PlayerStats = me?.stats ?? {};
  const username = profile?.username || user.displayName || user.email?.split("@")[0] || "Player";
  const displayName = profile?.display_name || username;
  const attrs = stats.attributes ?? {};
  const initials = displayName.slice(0, 2).toUpperCase();
  const mfaEnabled = mfaFactors.length > 0 || !!profile?.mfa_enabled;

  return (
    <PageShell>
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-16">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <BroadcastKicker tone="gold">
              <span className="signal-dot" />
              Player dossier
            </BroadcastKicker>
            <h1 className="mt-4 font-display text-5xl uppercase leading-[0.9] tracking-[0.03em] text-bone sm:text-6xl">
              {displayName}
            </h1>
            <p className="mt-3 text-sm text-dim">
              {stats.style ? `The Dealer's read: ${stats.style}` : "No matches recorded yet."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/lobby"
              className="border border-gold bg-gold px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-void transition hover:border-bone hover:bg-bone"
            >
              Enter a room
            </Link>
            <button
              type="button"
              onClick={async () => {
                await signOut(getFirebaseAuth());
                window.location.href = "/";
              }}
              className="border border-bone/20 px-5 py-2.5 text-xs uppercase tracking-[0.16em] text-dim transition hover:border-red/60 hover:text-red"
            >
              Sign out
            </button>
          </div>
        </div>

        {(error || notice) && (
          <div aria-live="polite" className="mt-6 space-y-2">
            {error && (
              <p className="border border-red/35 bg-red/[0.06] p-4 text-sm text-red">{error}</p>
            )}
            {notice && (
              <p className="border border-green/35 bg-green/[0.06] p-4 text-sm text-green">
                {notice}
              </p>
            )}
          </div>
        )}

        <section className="mt-8 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="broadcast-panel panel-cut relative overflow-hidden p-6 sm:p-8">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <div className="relative grid h-28 w-28 shrink-0 place-items-center overflow-hidden border border-gold/40 bg-gradient-to-br from-gold/20 via-panel to-void">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <>
                    <span className="absolute inset-2 border border-bone/10" />
                    <span className="font-display text-4xl tracking-[0.08em] text-bone">
                      {initials}
                    </span>
                  </>
                )}
                <span className="absolute bottom-1.5 right-2 text-xs text-gold">♠</span>
              </div>
              <div className="min-w-0">
                <p className="mono text-[9px] uppercase tracking-[0.24em] text-ash">
                  Broadcast identity
                </p>
                <h2 className="mt-1 truncate text-2xl font-semibold text-bone">{displayName}</h2>
                <p className="mono mt-1 text-[10px] uppercase tracking-[0.18em] text-ash">
                  @{username}
                </p>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-dim">
                  Your public dossier, account controls and security factors. Avatar selection and
                  uploads arrive with the lobby identity pass.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[
                    ["Matches", stats.matches ?? 0],
                    ["Escapes", stats.escapes ?? 0],
                    ["Accuracy", `${Math.round((stats.accuracy ?? 0) * 100)}%`],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="min-w-[92px] border border-bone/10 bg-void/50 px-3 py-2"
                    >
                      <div className="mono text-lg text-gold">{value}</div>
                      <div className="mono text-[8px] uppercase tracking-[0.18em] text-ash">
                        {label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-8 border-t border-bone/10 pt-6">
              <div className="flex items-center justify-between gap-4">
                <p className="mono text-[10px] uppercase tracking-[0.28em] text-gold">
                  The Dealer's player model
                </p>
                <span className="mono text-[9px] uppercase tracking-[0.16em] text-ash">
                  Six attributes
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {Object.entries(ATTR_LABELS).map(([key, label]) => {
                  const value = Math.round((attrs[key] ?? 0) * 100);
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-dim">{label}</span>
                        <span className="mono text-xs text-bone">{value}%</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden bg-bone/10">
                        <div
                          className="h-full bg-gradient-to-r from-blue via-yellow to-green transition-all duration-700"
                          style={{ width: `${value}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <form
              className="mt-8 grid gap-4 border-t border-bone/10 pt-6 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                saveProfile();
              }}
            >
              <div>
                <label
                  htmlFor="profile-username"
                  className="mono text-[9px] uppercase tracking-[0.2em] text-dim"
                >
                  Username
                </label>
                <input
                  id="profile-username"
                  value={editName}
                  maxLength={24}
                  onChange={(event) => setEditName(event.target.value)}
                  className="mt-2 w-full border border-bone/15 bg-void/70 px-3 py-2.5 text-sm text-bone outline-none transition focus:border-gold/70"
                />
              </div>
              <div>
                <label
                  htmlFor="profile-display"
                  className="mono text-[9px] uppercase tracking-[0.2em] text-dim"
                >
                  Display name
                </label>
                <input
                  id="profile-display"
                  value={editDisplay}
                  maxLength={48}
                  onChange={(event) => setEditDisplay(event.target.value)}
                  className="mt-2 w-full border border-bone/15 bg-void/70 px-3 py-2.5 text-sm text-bone outline-none transition focus:border-gold/70"
                />
              </div>
              <button
                type="submit"
                disabled={busy || !editName.trim()}
                className="border border-gold bg-gold px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-void transition hover:border-bone hover:bg-bone disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </form>
          </div>

          <aside className="space-y-4">
            <section className="border border-bone/10 bg-bone/[0.025] p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="mono text-[10px] uppercase tracking-[0.28em] text-gold">
                  Account signal
                </p>
                <span
                  className={`h-2 w-2 rounded-full ${
                    user.emailVerified
                      ? "bg-green shadow-[0_0_10px_rgba(88,214,141,.8)]"
                      : "bg-yellow"
                  }`}
                />
              </div>
              <div className="mt-4 space-y-3 text-xs">
                <div className="flex items-center justify-between gap-3 border-b border-bone/[0.06] pb-3">
                  <span className="text-dim">Identity</span>
                  <span className="mono text-bone">Firebase Auth</span>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-bone/[0.06] pb-3">
                  <span className="text-dim">Email</span>
                  <span className="mono max-w-[190px] truncate text-bone">
                    {user.email ?? "Not provided"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-bone/[0.06] pb-3">
                  <span className="text-dim">Verification</span>
                  <span className={`mono ${user.emailVerified ? "text-green" : "text-yellow"}`}>
                    {user.emailVerified ? "Verified" : "Pending"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-bone/[0.06] pb-3">
                  <span className="text-dim">Second factor</span>
                  <span className={`mono ${mfaEnabled ? "text-green" : "text-dim"}`}>
                    {mfaEnabled ? "Enabled" : "Optional"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-dim">Profile data</span>
                  <span className="mono text-bone">Supabase</span>
                </div>
              </div>

              {!user.emailVerified && (
                <button
                  type="button"
                  onClick={resendVerification}
                  disabled={busy}
                  className="mt-4 w-full border border-yellow/40 bg-yellow/10 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-yellow transition hover:bg-yellow hover:text-void disabled:opacity-40"
                >
                  {busy ? "Sending…" : "Resend verification email"}
                </button>
              )}
            </section>

            <section className="border border-bone/10 bg-bone/[0.025] p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="mono text-[10px] uppercase tracking-[0.28em] text-gold">
                  Multi-factor auth
                </p>
                <span className="mono text-[9px] uppercase tracking-[0.14em] text-ash">
                  TOTP
                </span>
              </div>

              {mfaFactors.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {mfaFactors.map((factor) => (
                    <div
                      key={factor.uid}
                      className="flex items-center justify-between gap-3 border border-bone/[0.08] bg-void/50 p-3"
                    >
                      <div>
                        <div className="mono text-[10px] uppercase tracking-[0.14em] text-bone">
                          {factor.displayName || "Authenticator app"}
                        </div>
                        <div className="mono mt-1 text-[9px] uppercase tracking-[0.12em] text-ash">
                          {factor.factorId}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => disableMfa(factor)}
                        disabled={mfaBusy}
                        className="mono text-[9px] uppercase tracking-[0.16em] text-red transition hover:text-bone disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : mfaSecret ? (
                <div className="mt-4 space-y-3">
                  <p className="text-xs leading-relaxed text-dim">
                    Add the secret below to an authenticator app, then enter the current code.
                  </p>
                  <div className="break-all border border-bone/10 bg-void/60 p-3 font-mono text-[11px] text-gold">
                    {mfaSecret.secretKey}
                  </div>
                  <a
                    href={mfaSecret.generateQrCodeUrl(user.email ?? "player", "AXIOM")}
                    className="mono block break-all text-[9px] uppercase tracking-[0.12em] text-dim underline underline-offset-2 hover:text-bone"
                  >
                    Open otpauth link
                  </a>
                  <input
                    value={mfaCode}
                    onChange={(event) => setMfaCode(event.target.value.replace(/\s/g, ""))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    placeholder="000000"
                    className="mono w-full border border-bone/15 bg-void/70 px-3 py-2.5 text-center text-lg tracking-[0.35em] text-bone outline-none focus:border-gold/70"
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={confirmMfa}
                      disabled={mfaBusy || mfaCode.trim().length < 6}
                      className="border border-gold bg-gold px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-void transition hover:border-bone hover:bg-bone disabled:opacity-40"
                    >
                      {mfaBusy ? "Enrolling…" : "Confirm code"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMfaSecret(null);
                        setMfaCode("");
                      }}
                      disabled={mfaBusy}
                      className="border border-bone/20 px-4 py-2.5 text-[10px] uppercase tracking-[0.16em] text-dim transition hover:text-bone disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="mt-3 text-xs leading-relaxed text-dim">
                    Add a time-based authenticator as a second factor. This is optional and may
                    require Identity Platform on the Firebase project.
                  </p>
                  <button
                    type="button"
                    onClick={startMfa}
                    disabled={mfaBusy}
                    className="mt-4 w-full border border-bone/20 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-bone transition hover:border-neon/60 hover:text-neon disabled:opacity-40"
                  >
                    {mfaBusy ? "Opening…" : "Enroll authenticator app"}
                  </button>
                </>
              )}
            </section>

            <section className="border border-red/25 bg-red/[0.04] p-5">
              <p className="mono text-[10px] uppercase tracking-[0.24em] text-red">
                The room remembers
              </p>
              <p className="mt-2 text-xs leading-relaxed text-dim">
                The Dealer updates your player model after every match. Patterns you repeat become
                pressure the arena can use.
              </p>
            </section>
          </aside>
        </section>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <section className="border border-bone/10 bg-bone/[0.025] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="mono text-[10px] uppercase tracking-[0.28em] text-gold">
                Match history
              </p>
              <span className="mono text-[9px] uppercase tracking-[0.16em] text-ash">
                Recent broadcasts
              </span>
            </div>
            <div className="mt-4 space-y-2">
              {!user.emailVerified && (
                <p className="border border-yellow/30 bg-yellow/[0.04] p-4 text-xs text-yellow">
                  Match history unlocks after email verification.
                </p>
              )}
              {user.emailVerified && history.length === 0 && (
                <p className="border border-dashed border-bone/15 p-5 text-sm text-dim">
                  No matches yet. Play a round to populate this feed.
                </p>
              )}
              {history.map((match) => (
                <div
                  key={match.id}
                  className="flex items-center justify-between gap-4 border border-bone/[0.08] bg-void/50 p-3.5 text-sm transition hover:border-bone/20"
                >
                  <div>
                    <div className="mono text-bone">{match.room}</div>
                    <div className="mono mt-1 text-[9px] uppercase tracking-[0.14em] text-ash">
                      {match.cycles} rounds · {Math.round(match.duration)}s · skill{" "}
                      {Math.round((match.team_skill ?? 0) * 100)}%
                    </div>
                  </div>
                  <span
                    className={`mono text-[10px] uppercase tracking-[0.16em] ${
                      match.winner ? "text-green" : "text-dim"
                    }`}
                  >
                    {match.winner ? "escaped" : "trapped"}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-bone/10 bg-bone/[0.025] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="mono text-[10px] uppercase tracking-[0.28em] text-gold">Leaderboard</p>
              <span className="mono text-[9px] uppercase tracking-[0.16em] text-ash">
                Global signal
              </span>
            </div>
            <div className="mt-4 space-y-2">
              {leaders.length === 0 && (
                <p className="border border-dashed border-bone/15 p-5 text-sm text-dim">
                  No ranked players yet.
                </p>
              )}
              {leaders.map((leader, index) => (
                <div
                  key={leader.username}
                  className="flex items-center gap-3 border border-bone/[0.08] bg-void/50 p-3.5 text-sm transition hover:border-bone/20"
                >
                  <span className="mono w-6 text-xs text-gold">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 truncate text-bone">{leader.username}</span>
                  <span className="mono text-[9px] uppercase tracking-[0.12em] text-ash">
                    {leader.matches} matches
                  </span>
                  <span className="mono text-xs text-green">
                    {Math.round((leader.pattern ?? 0) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </PageShell>
  );
}
