import type { CharacterId, GuestIdentity, PfpPresetId } from "../../contracts/avatar.types";
import { CHARACTER_IDS, DEFAULT_CHARACTER_ID } from "../characters/CharacterRegistry";
import {
  GUEST_DB_NAME,
  GUEST_STORAGE_KEY,
  GUEST_STORE_NAME,
  isAllowedPfpType,
  MAX_PFP_BYTES,
} from "./constants";
import { isPfpPresetId } from "./pfpCatalog";

function randomSuffix(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 4).toUpperCase();
  }
  return Math.floor(Math.random() * 9000 + 1000).toString();
}

function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === "string" && (CHARACTER_IDS as readonly string[]).includes(value);
}

export function defaultGuestIdentity(): GuestIdentity {
  return {
    name: `Guest${randomSuffix()}`,
    pfpPresetId: "spade",
    characterId: DEFAULT_CHARACTER_ID,
    customPfpKey: null,
    updatedAt: Date.now(),
  };
}

export function loadGuestIdentity(): GuestIdentity {
  const fallback = defaultGuestIdentity();
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(GUEST_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<GuestIdentity>;
    const preset: PfpPresetId | null = isPfpPresetId(parsed.pfpPresetId)
      ? parsed.pfpPresetId
      : (fallback.pfpPresetId ?? null);
    const character = isCharacterId(parsed.characterId) ? parsed.characterId : fallback.characterId;
    const name = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.slice(0, 24) : fallback.name;
    return {
      name,
      pfpPresetId: preset,
      characterId: character,
      customPfpKey:
        preset === null && typeof parsed.customPfpKey === "string" ? parsed.customPfpKey : null,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return fallback;
  }
}

export function saveGuestIdentity(identity: GuestIdentity): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(identity));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(GUEST_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(GUEST_STORE_NAME)) {
        request.result.createObjectStore(GUEST_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
  });
}

function putBlob(key: string, blob: Blob): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(GUEST_STORE_NAME, "readwrite");
        tx.objectStore(GUEST_STORE_NAME).put(blob, key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("IndexedDB write failed."));
        };
      })
  );
}

function getBlob(key: string): Promise<Blob | null> {
  return openDb().then(
    (db) =>
      new Promise<Blob | null>((resolve, reject) => {
        const request = db.transaction(GUEST_STORE_NAME, "readonly").objectStore(GUEST_STORE_NAME).get(key);
        request.onsuccess = () => {
          db.close();
          resolve(request.result instanceof Blob ? request.result : null);
        };
        request.onerror = () => {
          db.close();
          reject(request.error ?? new Error("IndexedDB read failed."));
        };
      })
  );
}

function deleteBlob(key: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(GUEST_STORE_NAME, "readwrite");
        tx.objectStore(GUEST_STORE_NAME).delete(key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("IndexedDB delete failed."));
        };
      })
  );
}

export async function saveGuestPfp(file: File): Promise<GuestIdentity> {
  if (!isAllowedPfpType(file.type)) throw new Error("Use a PNG, JPEG or WebP image.");
  if (file.size > MAX_PFP_BYTES) throw new Error("Image must be under 2 MB.");

  const key = `guest-pfp-${randomSuffix()}-${Date.now()}`;
  await putBlob(key, file);
  const identity = { ...loadGuestIdentity(), pfpPresetId: null, customPfpKey: key, updatedAt: Date.now() };
  saveGuestIdentity(identity);
  return identity;
}

export async function loadGuestPfpObjectUrl(key: string | null | undefined): Promise<string | null> {
  if (!key || typeof window === "undefined") return null;
  const blob = await getBlob(key);
  return blob ? URL.createObjectURL(blob) : null;
}

export async function selectGuestPfpPreset(presetId: PfpPresetId): Promise<GuestIdentity> {
  const current = loadGuestIdentity();
  const identity = { ...current, pfpPresetId: presetId, customPfpKey: null, updatedAt: Date.now() };
  if (current.customPfpKey) await deleteBlob(current.customPfpKey);
  saveGuestIdentity(identity);
  return identity;
}

export function renameGuest(name: string): GuestIdentity {
  const clean = name.trim().slice(0, 24) || defaultGuestIdentity().name;
  const identity = { ...loadGuestIdentity(), name: clean, updatedAt: Date.now() };
  saveGuestIdentity(identity);
  return identity;
}

export function selectGuestCharacter(characterId: CharacterId): GuestIdentity {
  const identity = { ...loadGuestIdentity(), characterId, updatedAt: Date.now() };
  saveGuestIdentity(identity);
  return identity;
}

export async function clearGuestIdentity(): Promise<void> {
  const current = loadGuestIdentity();
  if (current.customPfpKey) await deleteBlob(current.customPfpKey);
  if (typeof window !== "undefined") window.localStorage.removeItem(GUEST_STORAGE_KEY);
}

export function guestAuthFrame(identity: GuestIdentity): Record<string, unknown> {
  return {
    type: "auth",
    guest: true,
    name: identity.name,
    pfp_preset_id: identity.pfpPresetId,
    character_id: identity.characterId,
  };
}
