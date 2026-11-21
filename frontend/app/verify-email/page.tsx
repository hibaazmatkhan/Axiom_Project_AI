"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import { BroadcastKicker, SuitMark } from "@/components/Brand";
import { authErrorMessage } from "@/lib/authErrors";
import { firebaseConfigured, getFirebaseAuth } from "@/lib/firebase";
import { applyActionCode, checkActionCode } from "firebase/auth";

export default function VerifyEmailPage() {
  const [mode, setMode] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("oobCode");
    const actionMode = params.get("mode");
    setMode(actionMode);

    if (!firebaseConfigured) {
      setError("Firebase is not configured. Add the `FIREBASE_*` values to `frontend/.env.local`.");
      setBusy(false);
      return;
    }
    if (!code) {
      setError("This verification link is missing its code.");
      setBusy(false);
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (actionMode === "verifyEmail" || !actionMode) {
        try {
          await applyActionCode(getFirebaseAuth(), code);
        } catch (cause) {
          try {
            await checkActionCode(getFirebaseAuth(), code);
          } catch {
            throw cause;
          }
        }
      } else {
        await checkActionCode(getFirebaseAuth(), code);
      }
      const current = getFirebaseAuth().currentUser;
      if (current) await current.reload();
      setMessage("Email verified. Your account signal is up to date.");
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const refreshStatus = async () => {
    const current = getFirebaseAuth().currentUser;
    if (!current) {
      setError("Sign in to check your verification status.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await current.reload();
      setMessage(
        current.emailVerified
          ? "Email verified. Your account signal is up to date."
          : "Your email is still unverified."
      );
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void verify();
  }, []);

  return (
    <PageShell hideFooter>
      <main className="mx-auto flex min-h-[calc(100vh-68px)] max-w-lg items-center px-4 py-12 sm:px-6">
        <section className="broadcast-panel panel-cut relative w-full p-8">
          <BroadcastKicker tone="gold">
            <SuitMark className="text-sm" />
            Account signal
          </BroadcastKicker>
          <h1 className="mt-5 font-display text-4xl uppercase tracking-[0.03em] text-bone">
            Verify email
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-dim">
            {busy
              ? "Checking the action code…"
              : mode
                ? `Action: ${mode}.`
                : "Checking your account signal…"}
          </p>
          {!firebaseConfigured && (
            <div className="mt-6 border border-red/40 bg-red/10 p-4 text-sm text-red">
              Firebase is not configured. Add the `FIREBASE_*` values to `frontend/.env.local`.
            </div>
          )}
          {(error || message) && (
            <p
              aria-live="polite"
              className={`mt-5 border p-4 text-sm ${error ? "border-red/35 bg-red/[0.06] text-red" : "border-green/35 bg-green/[0.06] text-green"}`}
            >
              {error || message}
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void verify()}
              disabled={busy || !firebaseConfigured}
              className="border border-gold bg-gold px-5 py-3 text-sm font-bold uppercase tracking-[0.16em] text-void transition hover:bg-bone disabled:opacity-40"
            >
              {busy ? "Checking…" : "Retry verification link"}
            </button>
            <button
              type="button"
              onClick={() => void refreshStatus()}
              disabled={busy || !firebaseConfigured}
              className="border border-bone/20 px-5 py-3 text-sm font-medium uppercase tracking-[0.16em] text-bone transition hover:border-neon/60 hover:text-neon disabled:opacity-40"
            >
              Check status
            </button>
          </div>
          <div className="mt-6 flex flex-wrap gap-4">
            <Link
              href="/profile"
              className="mono text-[10px] uppercase tracking-[0.2em] text-gold hover:text-bone"
            >
              Open player dossier →
            </Link>
            <Link
              href="/lobby"
              className="mono text-[10px] uppercase tracking-[0.2em] text-gold hover:text-bone"
            >
              Enter the lobby →
            </Link>
          </div>
        </section>
      </main>
    </PageShell>
  );
}
