import Link from "next/link";

const SUITS = ["\u2660", "\u2665", "\u2666", "\u2663"] as const;
const SUIT_TONES = ["text-bone", "text-red", "text-red", "text-bone"] as const;

export function SuitMark({
  className = "",
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-grid grid-cols-2 gap-x-0.5 text-[0.62em] leading-none ${animated ? "animate-flicker" : ""} ${className}`}
    >
      {SUITS.map((suit, i) => (
        <span key={suit} className={SUIT_TONES[i]}>
          {suit}
        </span>
      ))}
    </span>
  );
}

export function Brand({
  href = "/",
  compact = false,
  className = "",
}: {
  href?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-3 focus-ring ${className}`}
      aria-label="Alice in Borderland: The Last Room home"
    >
      <span className="relative grid h-10 w-10 shrink-0 place-items-center border border-bone/25 bg-bone/[0.04] text-[19px] shadow-signal transition group-hover:border-gold/60">
        <span className="absolute left-0 top-0 h-2 w-2 border-l border-t border-gold/80" />
        <span className="absolute bottom-0 right-0 h-2 w-2 border-b border-r border-neon/70" />
        <SuitMark animated />
      </span>
      <span className="min-w-0">
        <span
          className={`block truncate font-display uppercase leading-none tracking-[0.18em] text-bone ${
            compact ? "text-base" : "text-lg sm:text-xl"
          }`}
        >
          Alice in Borderland
        </span>
        <span className="mono mt-1 block truncate text-[9px] uppercase tracking-[0.42em] text-gold/80">
          The Last Room
        </span>
      </span>
    </Link>
  );
}

export function BroadcastKicker({
  children,
  tone = "gold",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "gold" | "red" | "neon";
  className?: string;
}) {
  const tones = {
    gold: "border-gold/30 bg-gold/[0.06] text-gold",
    red: "border-red/35 bg-red/[0.07] text-red",
    neon: "border-neon/30 bg-neon/[0.06] text-neon",
  };
  return (
    <p
      className={`mono inline-flex items-center gap-2 border px-3 py-1.5 text-[10px] uppercase tracking-[0.28em] ${tones[tone]} ${className}`}
    >
      {children}
    </p>
  );
}
