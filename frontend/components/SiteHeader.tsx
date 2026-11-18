"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "./Brand";
import { useAuth } from "./AuthProvider";

const LINKS = [
  { href: "/", label: "Broadcast" },
  { href: "/lobby", label: "Lobby" },
  { href: "/profile", label: "Profile" },
];

export default function SiteHeader() {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname?.startsWith(href);
  const label = user?.displayName || user?.email?.split("@")[0] || "Player";

  return (
    <header className="sticky top-0 z-40 border-b border-bone/10 bg-void/80 backdrop-blur-xl">
      <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Brand compact />

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={`relative px-4 py-2 text-xs uppercase tracking-[0.22em] transition focus-ring ${
                isActive(link.href)
                  ? "text-bone"
                  : "text-dim hover:text-bone"
              }`}
            >
              {link.label}
              {isActive(link.href) && (
                <span className="absolute inset-x-4 -bottom-[17px] h-px bg-gold shadow-glow" />
              )}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <span className="mono flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-dim">
            <span className="signal-dot" />
            Live
          </span>
          {loading ? (
            <span className="mono px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-ash">
              Syncing
            </span>
          ) : user ? (
            <Link
              href="/profile"
              title={user.email ?? label}
              className="flex max-w-[200px] items-center gap-2 border border-bone/15 bg-bone/[0.04] px-3 py-2 text-xs text-bone transition hover:border-gold/50 focus-ring"
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  user.emailVerified ? "bg-green" : "bg-yellow"
                }`}
              />
              <span className="truncate">{label}</span>
            </Link>
          ) : (
            <Link
              href="/login"
              className="border border-gold/50 bg-gold/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold transition hover:bg-gold hover:text-void focus-ring"
            >
              Sign in
            </Link>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="grid h-10 w-10 place-items-center border border-bone/20 text-bone transition hover:border-gold/60 focus-ring md:hidden"
          aria-label="Toggle navigation"
        >
          <span className="text-lg leading-none">{open ? "\u00d7" : "\u2630"}</span>
        </button>
      </div>

      {open && (
        <div id="mobile-nav" className="border-t border-bone/10 bg-void/95 px-4 py-3 md:hidden">
          <nav className="flex flex-col" aria-label="Mobile navigation">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`border-b border-bone/[0.06] px-2 py-3 text-sm uppercase tracking-[0.2em] ${
                  isActive(link.href) ? "text-gold" : "text-dim"
                }`}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href={user ? "/profile" : "/login"}
              className="mt-3 border border-gold/50 bg-gold/10 px-3 py-3 text-center text-xs font-semibold uppercase tracking-[0.2em] text-gold"
            >
              {user ? `Signed in as ${label}` : "Sign in / create account"}
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
