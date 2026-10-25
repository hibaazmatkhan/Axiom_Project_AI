"use client";
import { useSearchParams } from "next/navigation";
import GameClient from "@/components/GameClient";

export default function GameLoader() {
  const params = useSearchParams();
  const room = params.get("room") ?? "LOBBY";
  const name = params.get("name") ?? "Player";
  return <GameClient room={room} name={name} />;
}
