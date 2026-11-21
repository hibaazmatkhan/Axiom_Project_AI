"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "./AuthProvider";

export default function RequireAuth({
  children,
  next = "/profile",
}: {
  children: ReactNode;
  next?: string;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [loading, user, router, next]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-void text-xs uppercase tracking-[0.2em] text-dim">
        Checking credentials…
      </div>
    );
  }

  return <>{children}</>;
}
