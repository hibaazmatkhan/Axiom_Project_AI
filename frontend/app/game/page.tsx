import { Suspense } from "react";
import { SuitMark } from "@/components/Brand";
import GameLoader from "./GameLoader";

export default function GamePage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-screen place-items-center bg-void px-4 text-bone">
          <div className="border border-bone/15 bg-bone/[0.03] px-8 py-7 text-center">
            <SuitMark className="mx-auto text-3xl text-gold animate-flicker" />
            <p className="mono mt-4 text-[10px] uppercase tracking-[0.32em] text-gold">
              Joining the broadcast
            </p>
            <p className="mt-2 text-xs text-dim">Synchronising the arena…</p>
          </div>
        </main>
      }
    >
      <GameLoader />
    </Suspense>
  );
}
