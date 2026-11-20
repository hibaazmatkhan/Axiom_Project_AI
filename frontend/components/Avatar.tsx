"use client";

import { useEffect, useState } from "react";
import { findCharacter } from "@/lib/characters";

const PALETTE = ["#7aa2f7", "#f7768e", "#e0af68", "#9ece6a", "#bb9af7", "#7dcfff"];

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) >>> 0;
  }
  return result;
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

type AvatarProps = {
  src?: string | null;
  name: string;
  characterId?: string | null;
  size?: number;
  color?: string | null;
  className?: string;
  showSuit?: boolean;
};

export default function Avatar({
  src,
  name,
  characterId,
  size = 32,
  color,
  className = "",
  showSuit = true,
}: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const character = findCharacter(characterId);
  const label = character?.name || name || "player";
  const tone = color || character?.color || PALETTE[hash(label) % PALETTE.length];

  useEffect(() => setFailed(false), [src]);

  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden border border-bone/20 bg-void text-bone ${className}`}
      style={{ width: size, height: size, borderRadius: Math.max(2, size * 0.18) }}
      aria-hidden="true"
    >
      <span
        className="absolute inset-0 opacity-30"
        style={{ background: `linear-gradient(135deg, ${tone}, transparent 70%)` }}
      />
      {src && !failed ? (
        <img
          src={src}
          alt=""
          className="relative h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="relative font-display font-semibold leading-none"
          style={{ fontSize: Math.max(9, size * 0.34), color: tone }}
        >
          {initials(label)}
        </span>
      )}
      {showSuit && size >= 24 && (
        <span
          className="absolute bottom-0 right-[1px] leading-none text-gold/80"
          style={{ fontSize: Math.max(7, size * 0.24) }}
        >
          {character?.suit ?? "♠"}
        </span>
      )}
    </span>
  );
}
