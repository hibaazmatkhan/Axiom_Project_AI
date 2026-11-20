"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import { BroadcastKicker, SuitMark } from "@/components/Brand";
import { authErrorMessage } from "@/lib/authErrors";
import { getFirebaseAuth } from "@/lib/firebase";
import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";

export default function ResetPasswordPage() {
  const [code, setCode] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("oobCode");
    setCode(value);
    if (!value) {
      setError("This reset link is missing its code.");
      return;
    }
    void verifyPasswordResetCode(getFirebaseAuth(), value)
      .then(setEmail)
      .catch(() => setError("This reset link is invalid or has expired."));
  }, []);

  const submit = async () => {
    if (!code || busy) return;
    if (password.length < 6) {
      setError("Use at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await confirmPasswordReset(getFirebaseAuth(), code, password);
      setMessage("Password updated. You can sign in now.");
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell hideFooter>
      <main className="mx-auto flex min-h-[calc(100vh-68px)] max-w-lg items-center px-4 py-12 sm:px-6">
        <section className="broadcast-panel panel-cut relative w-full p-8">
          <BroadcastKicker tone="gold">
            <SuitMark className="text-sm" />
            Account recovery
          </BroadcastKicker>
          <h1 className="mt-5 font-display text-4xl uppercase tracking-[0.03em] text-bone">
            New password
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-dim">
            {email ? `Resetting the password for ${email}.` : "Verifying your reset link…"}
          </p>
          {(error || message) && (
            <p
              aria-live="polite"
              className={`mt-5 border p-4 text-sm ${error ? "border-red/35 bg-red/[0.06] text-red" : "border-green/35 bg-green/[0.06] text-green"}`}
            >
              {error || message}
            </p>
          )}
          {!message && code && (
            <div className="mt-6 space-y-4">
              <div>
                <label htmlFor="new-password" className="mono text-[10px] uppercase tracking-[0.2em] text-dim">
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 w-full border border-bone/15 bg-void/70 px-4 py-3 text-sm text-bone outline-none transition focus:border-gold/70"
                />
              </div>
              <div>
                <label htmlFor="confirm-password" className="mono text-[10px] uppercase tracking-[0.2em] text-dim">
                  Confirm password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  className="mt-2 w-full border border-bone/15 bg-void/70 px-4 py-3 text-sm text-bone outline-none transition focus:border-gold/70"
                />
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="w-full border border-gold bg-gold px-5 py-3 text-sm font-bold uppercase tracking-[0.16em] text-void transition hover:bg-bone disabled:opacity-40"
              >
                {busy ? "Updating…" : "Set password"}
              </button>
            </div>
          )}
          <Link href="/login" className="mono mt-6 inline-block text-[10px] uppercase tracking-[0.2em] text-gold hover:text-bone">
            Back to sign in
          </Link>
        </section>
      </main>
    </PageShell>
  );
}
