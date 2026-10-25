"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, auth } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    const fn = mode === "login" ? api.login : api.signup;
    const res = await fn(username.trim(), password);
    setBusy(false);
    if (!res) {
      setMsg("Cannot reach the server.");
      return;
    }
    if (!res.ok) {
      setMsg(res.error ?? "Something went wrong.");
      return;
    }
    auth.set(username.trim());
    router.push(mode === "signup" ? "/profile" : "/lobby");
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-void px-4 text-bone">
      <div className="pointer-events-none absolute inset-0 grid-backdrop" />
      <div className="relative z-10 w-full max-w-md animate-rise">
        <Link href="/" className="mono text-xs tracking-[0.3em] text-dim transition hover:text-cir">
          ← AXIOM
        </Link>

        <div className="glass mt-6 rounded-3xl p-8 shadow-card">
          <div className="mb-6 flex rounded-xl border border-edge p-1 text-sm">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setMsg(null); }}
                className={`flex-1 rounded-lg py-2 transition ${
                  mode === m ? "bg-cir font-medium text-void" : "text-dim hover:text-bone"
                }`}
              >
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <label htmlFor="username" className="block text-sm text-dim">Username</label>
          <input
            id="username"
            value={username}
            maxLength={24}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full rounded-xl border border-edge bg-void/60 p-3 outline-none transition focus:border-cir"
          />

          <label htmlFor="password" className="mt-4 block text-sm text-dim">
            Password <span className="text-xs">(min 4 chars)</span>
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="mt-1 w-full rounded-xl border border-edge bg-void/60 p-3 outline-none transition focus:border-cir"
          />

          {msg && <p className="mt-3 text-sm text-danger">{msg}</p>}

          <button
            onClick={submit}
            disabled={busy || !username.trim() || password.length < 4}
            className="mt-6 w-full rounded-xl bg-bone p-3 font-semibold text-void transition hover:brightness-95 disabled:opacity-40"
          >
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>

          <p className="mt-4 text-center text-xs text-dim">
            Passwords are hashed with PBKDF2. Match history and NEXUS models are stored per account.
          </p>
        </div>
      </div>
    </main>
  );
}
