export type Character = {
  id: string;
  name: string;
  suit: string;
  color: string;
};

export const FALLBACK_CHARACTERS: Character[] = [
  { id: "arisu", name: "Arisu", suit: "♠", color: "#7aa2f7" },
  { id: "usagi", name: "Usagi", suit: "♥", color: "#f7768e" },
  { id: "chishiya", name: "Chishiya", suit: "♦", color: "#e0af68" },
  { id: "kuina", name: "Kuina", suit: "♣", color: "#9ece6a" },
  { id: "ann", name: "Ann", suit: "♠", color: "#bb9af7" },
  { id: "karube", name: "Karube", suit: "♥", color: "#ff9e64" },
  { id: "chota", name: "Chota", suit: "♦", color: "#7dcfff" },
  { id: "shibuki", name: "Shibuki", suit: "♣", color: "#73daca" },
  { id: "niragi", name: "Niragi", suit: "♠", color: "#f7768e" },
  { id: "aguni", name: "Aguni", suit: "♥", color: "#e0af68" },
  { id: "hatter", name: "Hatter", suit: "♦", color: "#bb9af7" },
  { id: "mira", name: "Mira", suit: "♣", color: "#9ece6a" },
  { id: "tatta", name: "Tatta", suit: "♠", color: "#7aa2f7" },
  { id: "lastboss", name: "Last Boss", suit: "♥", color: "#ff9e64" },
  { id: "heiya", name: "Heiya", suit: "♦", color: "#7dcfff" },
  { id: "kuzuryu", name: "Kuzuryu", suit: "♣", color: "#73daca" },
];

const ID_RE = /^[a-z0-9-]{1,32}$/;

export function characterUrl(id: string): string | null {
  return ID_RE.test(id) ? `/avatars/characters/${id}.png` : null;
}

export function findCharacter(id: string | null | undefined): Character | null {
  if (!id) return null;
  return FALLBACK_CHARACTERS.find((character) => character.id === id) ?? null;
}

export async function loadCharacters(): Promise<Character[]> {
  if (typeof window === "undefined") return FALLBACK_CHARACTERS;
  try {
    const response = await fetch("/avatars/characters/manifest.json", { cache: "no-store" });
    if (!response.ok) return FALLBACK_CHARACTERS;
    const data: unknown = await response.json();
    if (!Array.isArray(data)) return FALLBACK_CHARACTERS;
    const characters = data.filter((entry): entry is Character => {
      if (!entry || typeof entry !== "object") return false;
      const value = entry as Partial<Character>;
      return (
        typeof value.id === "string" &&
        ID_RE.test(value.id) &&
        typeof value.name === "string" &&
        typeof value.suit === "string" &&
        typeof value.color === "string"
      );
    });
    return characters.length ? characters : FALLBACK_CHARACTERS;
  } catch {
    return FALLBACK_CHARACTERS;
  }
}
