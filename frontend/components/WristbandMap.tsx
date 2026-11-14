"use client";
import type { Arena, Direction } from "@/lib/types";

const DOOR_HEX: Record<string, string> = {
  red: "#e23b3b",
  blue: "#3f7bd9",
  yellow: "#e8b53a",
  green: "#3f9f6b",
};
const SIGIL_GLYPH: Record<string, string> = {
  spade: "\u2660",
  heart: "\u2665",
  diamond: "\u2666",
  club: "\u2663",
};
const DIRS: Direction[] = ["N", "E", "S", "W"];

export default function WristbandMap({
  arena,
  youCode,
  className = "",
}: {
  arena: Arena | null;
  youCode: string | null;
  className?: string;
}) {
  if (!arena) return null;
  const size = arena.size;
  const exitCode = `${String.fromCharCode(65 + arena.exit_room[0])}${arena.exit_room[1] + 1}`;
  const grid: (typeof arena.rooms[number] | null)[][] = Array.from(
    { length: size },
    () => Array.from({ length: size }, () => null)
  );
  for (const room of arena.rooms) grid[room.by][room.bx] = room;

  return (
    <div
      className={`grid gap-1 ${className}`}
      style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
    >
      {grid.flat().map((room, i) => {
        if (!room) return <div key={i} className="aspect-square" />;
        const isYou = room.code === youCode;
        const isExit = room.code === exitCode;
        return (
          <div
            key={room.id ?? i}
            className={`relative aspect-square rounded-[5px] border bg-ink/70 ${
              isYou ? "border-yellow shadow-[0_0_12px_-2px_rgba(232,181,58,0.8)]" : isExit ? "border-yellow/70" : "border-edge/70"
            }`}
            title={`${room.code}${room.revealed && room.sanction ? ` · sanction ${room.sanction}` : ""}`}
          >
            {DIRS.map((d) => {
              const door = room.doors[d];
              const open = room.open?.[d];
              const color = DOOR_HEX[door.color] ?? "#6f7680";
              const style: React.CSSProperties = { background: color, opacity: door.sealed ? 0.18 : open ? 1 : 0.5 };
              const pos =
                d === "N" ? "left-1 right-1 top-0 h-[3px]"
                : d === "S" ? "left-1 right-1 bottom-0 h-[3px]"
                : d === "W" ? "top-1 bottom-1 left-0 w-[3px]"
                : "top-1 bottom-1 right-0 w-[3px]";
              return <span key={d} className={`absolute rounded-full ${pos}`} style={style} />;
            })}
            <div className="absolute inset-0 grid place-items-center">
              <span className={`mono text-[10px] leading-none ${isYou ? "text-yellow" : "text-bone/80"}`}>
                {room.code}
              </span>
            </div>
            {room.sigil && (
              <span className="absolute left-1 top-0.5 text-[9px] leading-none text-bone/70">
                {SIGIL_GLYPH[room.sigil] ?? ""}
              </span>
            )}
            {isExit && (
              <span className="absolute bottom-0.5 right-1 text-[8px] uppercase leading-none tracking-wider text-yellow">
                exit
              </span>
            )}
            {room.revealed && (room.sanction ?? 0) > 0 && (
              <span className="absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-red" />
            )}
          </div>
        );
      })}
    </div>
  );
}
