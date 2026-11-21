"use client";

import Link from "next/link";
import { SuitMark } from "@/components/Brand";

export default function GameError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const webgl = /webgl|context|canvas/i.test(error.message);

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-void px-4 text-bone">
      <section className="broadcast-panel panel-cut relative w-full max-w-xl p-8 text-center">
        <SuitMark className="mx-auto text-3xl text-red" />
        <p className="mono mt-5 text-[10px] uppercase tracking-[0.3em] text-red">
          Broadcast interrupted
        </p>
        <h1 className="mt-3 font-display text-4xl uppercase tracking-[0.03em] text-bone">
          {webgl ? "3D signal lost" : "The arena failed to load"}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-dim">
          {webgl
            ? "This browser could not start WebGL. Enable hardware acceleration or try another browser, then rejoin the room."
            : "A rendering error stopped the feed. Your match is still authoritative on the server."}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="border border-gold bg-gold px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-void transition hover:border-bone hover:bg-bone"
          >
            Rejoin broadcast
          </button>
          <Link
            href="/lobby"
            className="border border-bone/20 px-6 py-3 text-sm font-medium uppercase tracking-[0.16em] text-bone transition hover:border-neon/60 hover:text-neon"
          >
            Back to lobby
          </Link>
        </div>
        {error.digest && (
          <p className="mono mt-5 text-[9px] uppercase tracking-[0.18em] text-ash">
            Ref {error.digest}
          </p>
        )}
      </section>
    </main>
  );
}
