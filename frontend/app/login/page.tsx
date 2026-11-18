"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import PageShell from "@/components/PageShell";
import { BroadcastKicker, SuitMark } from "@/components/Brand";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@/lib/api";
import { authErrorMessage } from "@/lib/authErrors";
import { firebaseConfigured, getFirebaseAuth, getGoogleProvider } from "@/lib/firebase";
import {
  TotpMultiFactorGenerator,
  createUserWithEmailAndPassword,
  getMultiFactorResolver,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type MultiFactorError,
  type MultiFactorResolver,
} from "firebase/auth";

type Mode = "login" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolver, setResolver] = useState<MultiFactorResolver | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  const syncProfile = async (preferredUsername?: string) => {
    try {
      await api.me();
      if (preferredUsername) {
        await api.updateProfile({ username: preferredUsername, display_name: preferredUsername });
      }
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Profile storage is not ready.";
    }
  };

  const handleAuthError = (error: unknown) => {
    const code = (error as { code?: string })?.code;
    if (code === "auth/multi-factor-auth-required") {
      try {
        setResolver(getMultiFactorResolver(getFirebaseAuth(), error as MultiFactorError));
        setMsg(null);
        setInfo("This account is protected by a second factor. Enter the code from your authenticator app.");
        return;
      } catch {
        setMsg("This account needs a second factor, but the challenge could not be opened.");
        return;
      }
    }
    setMsg(authErrorMessage(error));
  };

  const submit = async () => {
    if (busy || !firebaseConfigured) return;
    setBusy(true);
    setMsg(null);
    setInfo(null);

    try {
      if (mode === "signup") {
        const cleanUsername = username.trim();
        if (cleanUsername.length < 3) {
          setMsg("Choose a broadcast name with at least 3 characters.");
          return;
        }
        const credential = await createUserWithEmailAndPassword(
          getFirebaseAuth(),
          email.trim(),
          password
        );
        await updateProfile(credential.user, { displayName: cleanUsername });
        await sendEmailVerification(credential.user).catch(() => undefined);
        await syncProfile(cleanUsername);
        router.push("/profile");
      } else {
        const credential = await signInWithEmailAndPassword(
          getFirebaseAuth(),
          email.trim(),
          password
        );
        await syncProfile();
        router.push(credential.user.emailVerified ? "/lobby" : "/profile");
      }
    } catch (error) {
      handleAuthError(error);
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    if (busy || !firebaseConfigured) return;
    setBusy(true);
    setMsg(null);
    setInfo(null);
    try {
      const credential = await signInWithPopup(getFirebaseAuth(), getGoogleProvider());
      await syncProfile();
      router.push(credential.user.emailVerified ? "/lobby" : "/profile");
    } catch (error) {
      handleAuthError(error);
    } finally {
      setBusy(false);
    }
  };

  const resolveMfa = async () => {
    if (!resolver || busy) return;
    const factor = resolver.hints.find((hint) => hint.factorId === "totp");
    if (!factor) {
      setMsg("This project currently supports authenticator-app MFA in the web client.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await resolver.resolveSignIn(
        TotpMultiFactorGenerator.assertionForSignIn(factor.uid, mfaCode.trim())
      );
      await syncProfile();
      setResolver(null);
      setMfaCode("");
      router.push("/lobby");
    } catch (error) {
      handleAuthError(error);
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!email.trim()) {
      setMsg("Enter your email address first.");
      return;
    }
    setBusy(true);
    setMsg(null);
    setInfo(null);
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
      setInfo("Password reset email sent. Check your inbox.");
    } catch (error) {
      setMsg(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const resendVerification = async () => {
    if (!user || busy) return;
    setBusy(true);
    setMsg(null);
    setInfo(null);
    try {
      await sendEmailVerification(user);
      setInfo("Verification email sent. Check your inbox.");
    } catch (error) {
      setMsg(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const label = user?.displayName || user?.email?.split("@")[0] || "Player";

  return (
    <PageShell hideFooter>
      <main className="mx-auto grid min-h-[calc(100vh-68px)] max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-20">
        <section className="relative hidden lg:block">
          <BroadcastKicker tone="red">
            <span className="signal-dot" />
            Player access
          </BroadcastKicker>
          <h1 className="mt-6 font-display text-7xl uppercase leading-[0.85] tracking-[0.02em] text-bone">
            The room
            <span className="block text-red red-glow">remembers.</span>
          </h1>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-dim">
            Your account keeps your match history, The Dealer's player model and your place on the
            leaderboard. The game does not pause while you decide.
          </p>

          <div className="mt-10 grid max-w-md grid-cols-2 gap-2">
            {[
              ["\u2660", "Navigator", "text-blue"],
              ["\u2665", "Oracle", "text-red"],
              ["\u2666", "Timekeeper", "text-yellow"],
              ["\u2663", "Archivist", "text-green"],
            ].map(([suit, role, tone]) => (
              <div
                key={role}
                className="flex items-center gap-3 border border-bone/10 bg-bone/[0.025] px-3 py-3"
              >
                <span className={`font-display text-2xl leading-none ${tone}`}>{suit}</span>
                <span className="mono text-[10px] uppercase tracking-[0.18em] text-dim">
                  {role}
                </span>
              </div>
            ))}
          </div>

          <SuitMark
            className="pointer-events-none absolute -bottom-16 right-0 text-8xl text-gold/10 suit-float"
            animated
          />
        </section>

        <section className="broadcast-panel panel-cut relative mx-auto w-full max-w-xl p-6 sm:p-9">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="mono text-[10px] uppercase tracking-[0.32em] text-gold">
                {resolver
                  ? "Second factor"
                  : user
                    ? "Active session"
                    : mode === "login"
                      ? "Returning player"
                      : "New player"}
              </p>
              <h2 className="mt-2 font-display text-4xl uppercase leading-none tracking-[0.03em] text-bone">
                {resolver
                  ? "Verify access"
                  : user
                    ? "Signal locked"
                    : mode === "login"
                      ? "Welcome back"
                      : "Join the broadcast"}
              </h2>
            </div>
            <SuitMark className="text-2xl text-bone/70" />
          </div>

          {!firebaseConfigured && (
            <div className="mt-6 border border-red/40 bg-red/10 p-4 text-sm text-red">
              Firebase is not configured. Add the `NEXT_PUBLIC_FIREBASE_*` values to
              `frontend/.env.local`.
            </div>
          )}

          {loading ? (
            <p className="mono mt-8 text-xs uppercase tracking-[0.2em] text-ash">
              Checking session…
            </p>
          ) : user ? (
            <div className="mt-6 space-y-4">
              <div className="border border-bone/10 bg-void/50 p-4">
                <div className="mono text-[9px] uppercase tracking-[0.22em] text-ash">
                  Signed in as
                </div>
                <div className="mt-1 text-lg text-bone">{label}</div>
                <div className="mt-1 text-xs text-dim">{user.email}</div>
                <div className="mt-3 flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      user.emailVerified ? "bg-green" : "bg-yellow"
                    }`}
                  />
                  <span className="mono text-[9px] uppercase tracking-[0.16em] text-dim">
                    {user.emailVerified ? "Email verified" : "Email not verified"}
                  </span>
                </div>
              </div>

              {!user.emailVerified && (
                <button
                  type="button"
                  onClick={resendVerification}
                  disabled={busy}
                  className="w-full border border-yellow/50 bg-yellow/10 px-5 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-yellow transition hover:bg-yellow hover:text-void disabled:opacity-40"
                >
                  {busy ? "Sending…" : "Resend verification email"}
                </button>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <Link
                  href="/lobby"
                  className="border border-gold bg-gold px-5 py-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-void transition hover:border-bone hover:bg-bone"
                >
                  Enter the lobby
                </Link>
                <Link
                  href="/profile"
                  className="border border-bone/20 px-5 py-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-bone transition hover:border-neon/60 hover:text-neon"
                >
                  Player dossier
                </Link>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await signOut(getFirebaseAuth());
                  setInfo("Signed out.");
                }}
                className="w-full border border-bone/15 px-5 py-3 text-xs uppercase tracking-[0.16em] text-dim transition hover:border-red/60 hover:text-red"
              >
                Sign out
              </button>
              <div aria-live="polite" className="min-h-5">
                {msg && <p className="text-sm text-red">{msg}</p>}
                {info && <p className="text-sm text-green">{info}</p>}
              </div>
            </div>
          ) : resolver ? (
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                resolveMfa();
              }}
            >
              <div className="border border-gold/25 bg-gold/[0.05] p-4 text-sm leading-relaxed text-dim">
                Open your authenticator app and enter the current 6-digit code for AXIOM.
              </div>
              {(msg || info) && (
                <div aria-live="polite" className="min-h-5">
                  {msg && <p className="text-sm text-red">{msg}</p>}
                  {info && <p className="text-sm text-green">{info}</p>}
                </div>
              )}
              <div>
                <label
                  htmlFor="mfa-code"
                  className="mono text-[10px] uppercase tracking-[0.2em] text-dim"
                >
                  Authenticator code
                </label>
                <input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value.replace(/\s/g, ""))}
                  className="mono mt-2 w-full border border-bone/15 bg-void/70 px-4 py-3 text-center text-xl tracking-[0.4em] text-bone outline-none transition focus:border-gold/70"
                  placeholder="000000"
                />
              </div>
              <button
                type="submit"
                disabled={busy || mfaCode.trim().length < 6}
                className="w-full border border-gold bg-gold px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-void transition hover:border-bone hover:bg-bone disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Verifying…" : "Complete sign-in"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setResolver(null);
                  setMfaCode("");
                  setInfo(null);
                  setMsg(null);
                }}
                className="w-full text-xs uppercase tracking-[0.16em] text-dim transition hover:text-bone"
              >
                Back
              </button>
            </form>
          ) : (
            <>
              <div className="mt-6 grid grid-cols-2 border border-bone/15 bg-void/40 p-1">
                {(["login", "signup"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setMode(item);
                      setMsg(null);
                      setInfo(null);
                    }}
                    className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                      mode === item ? "bg-bone text-void" : "text-dim hover:text-bone"
                    }`}
                  >
                    {item === "login" ? "Sign in" : "Create account"}
                  </button>
                ))}
              </div>

              <form
                className="mt-6 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                {mode === "signup" && (
                  <div>
                    <label
                      htmlFor="username"
                      className="mono text-[10px] uppercase tracking-[0.2em] text-dim"
                    >
                      Broadcast name
                    </label>
                    <input
                      id="username"
                      name="username"
                      value={username}
                      maxLength={24}
                      autoComplete="nickname"
                      onChange={(event) => setUsername(event.target.value)}
                      className="mt-2 w-full border border-bone/15 bg-void/70 px-4 py-3 text-sm text-bone outline-none transition placeholder:text-ash focus:border-gold/70"
                      placeholder="Your broadcast name"
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="email"
                    className="mono text-[10px] uppercase tracking-[0.2em] text-dim"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={email}
                    autoComplete="email"
                    onChange={(event) => setEmail(event.target.value)}
                    className="mt-2 w-full border border-bone/15 bg-void/70 px-4 py-3 text-sm text-bone outline-none transition placeholder:text-ash focus:border-gold/70"
                    placeholder="player@example.com"
                  />
                </div>

                <div>
                  <div className="flex items-baseline justify-between gap-3">
                    <label
                      htmlFor="password"
                      className="mono text-[10px] uppercase tracking-[0.2em] text-dim"
                    >
                      Password
                    </label>
                    {mode === "login" && (
                      <button
                        type="button"
                        onClick={resetPassword}
                        disabled={busy}
                        className="mono text-[9px] uppercase tracking-[0.16em] text-gold transition hover:text-bone disabled:opacity-40"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    value={password}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    onChange={(event) => setPassword(event.target.value)}
                    className="mt-2 w-full border border-bone/15 bg-void/70 px-4 py-3 text-sm text-bone outline-none transition placeholder:text-ash focus:border-gold/70"
                    placeholder="••••••••"
                  />
                  {mode === "signup" && (
                    <p className="mono mt-2 text-[9px] uppercase tracking-[0.16em] text-ash">
                      Firestore handles credentials. Profile data is stored by the game server.
                    </p>
                  )}
                </div>

                <div aria-live="polite" className="min-h-5">
                  {msg && <p className="text-sm text-red">{msg}</p>}
                  {info && <p className="text-sm text-green">{info}</p>}
                </div>

                <button
                  type="submit"
                  disabled={
                    busy ||
                    !firebaseConfigured ||
                    !email.trim() ||
                    password.length < 6 ||
                    (mode === "signup" && username.trim().length < 3)
                  }
                  className="w-full border border-gold bg-gold px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-void transition hover:border-bone hover:bg-bone disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "Transmitting…" : mode === "login" ? "Enter the lobby" : "Create player"}
                </button>
              </form>

              <div className="my-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-bone/10" />
                <span className="mono text-[9px] uppercase tracking-[0.24em] text-ash">or</span>
                <span className="h-px flex-1 bg-bone/10" />
              </div>

              <button
                type="button"
                onClick={google}
                disabled={busy || !firebaseConfigured}
                className="flex w-full items-center justify-center gap-3 border border-bone/20 bg-bone/[0.03] px-5 py-3 text-sm font-medium uppercase tracking-[0.16em] text-bone transition hover:border-neon/60 hover:text-neon disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="font-display text-lg leading-none">G</span>
                Continue with Google
              </button>

              <Link
                href="/lobby"
                className="mt-2 flex w-full items-center justify-center border border-bone/20 bg-bone/[0.03] px-5 py-3 text-sm font-medium uppercase tracking-[0.16em] text-bone transition hover:border-neon/60 hover:text-neon"
              >
                Continue as guest
              </Link>

              <p className="mt-6 text-center text-xs leading-relaxed text-ash">
                Guest play is available. Saved history, The Dealer's model and leaderboard placement
                require a verified account.
              </p>
            </>
          )}
        </section>
      </main>
    </PageShell>
  );
}
