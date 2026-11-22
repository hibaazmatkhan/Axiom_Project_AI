"use client";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import GameClient from "@/components/GameClient";

export default function GameLoader() {
  const params = useSearchParams();
  const { loading, user } = useAuth();
  const rawRoom = params.get("room") ?? "LOBBY";
  const room = rawRoom.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4) || "LOBBY";
  const name = params.get("name")?.trim() || user?.displayName || "Guest";
  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-void px-4 text-bone">
        <p className="mono text-[10px] uppercase tracking-[0.32em] text-gold">
          Verifying the broadcast…
        </p>
      </main>
    );
  }
  return <GameClient room={room} name={name} />;
}
