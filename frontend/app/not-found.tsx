import Link from "next/link";
import PageShell from "@/components/PageShell";
import { BroadcastKicker, SuitMark } from "@/components/Brand";

export default function NotFound() {
  return (
    <PageShell hideFooter>
      <main className="mx-auto flex min-h-[calc(100vh-68px)] max-w-7xl items-center justify-center px-4 py-12 sm:px-6">
        <section className="broadcast-panel panel-cut relative w-full max-w-xl p-8 text-center sm:p-10">
          <SuitMark className="mx-auto text-4xl text-gold animate-flicker" />
          <BroadcastKicker tone="red" className="mt-6">
            Signal lost
          </BroadcastKicker>
          <h1 className="mt-5 font-display text-5xl uppercase leading-[0.9] tracking-[0.03em] text-bone">
            This room does not exist.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-dim">
            The arena has shifted. Return to the broadcast and find a door that is still open.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              href="/"
              className="border border-gold bg-gold px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-void transition hover:border-bone hover:bg-bone"
            >
              Back to broadcast
            </Link>
            <Link
              href="/lobby"
              className="border border-bone/20 px-6 py-3 text-sm font-medium uppercase tracking-[0.16em] text-bone transition hover:border-neon/60 hover:text-neon"
            >
              Enter the lobby
            </Link>
          </div>
        </section>
      </main>
    </PageShell>
  );
}
