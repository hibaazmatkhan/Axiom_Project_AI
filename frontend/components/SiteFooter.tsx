import Link from "next/link";
import { SuitMark } from "./Brand";

export default function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-bone/10 bg-void/50">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-9 sm:px-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <div className="flex items-center gap-3">
            <SuitMark className="text-xl text-gold" />
            <span className="font-display text-lg uppercase tracking-[0.2em] text-bone">
              Alice in Borderland
            </span>
          </div>
          <p className="mono mt-2 text-[10px] uppercase tracking-[0.34em] text-dim">
            The Last Room · A game of possible futures
          </p>
          <p className="mt-4 max-w-xl text-xs leading-relaxed text-ash">
            Unofficial fan project. Not affiliated with Netflix or the original rights holders.
            Character likenesses are supplied by the project owner. Game systems and code are built
            for the AXIOM academic project.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-dim">
          <Link href="/lobby" className="transition hover:text-gold">
            Lobby
          </Link>
          <Link href="/profile" className="transition hover:text-gold">
            Profile
          </Link>
          <Link href="/login" className="transition hover:text-gold">
            Account
          </Link>
          <span className="mono text-[10px] uppercase tracking-[0.2em] text-ash">
            FastAPI · Three.js · Next.js
          </span>
        </div>
      </div>
    </footer>
  );
}
