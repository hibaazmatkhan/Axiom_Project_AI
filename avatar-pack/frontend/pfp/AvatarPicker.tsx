import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { CharacterId, PfpPresetId } from "../../contracts/avatar.types";
import { CHARACTER_IDS, CHARACTER_REGISTRY } from "../characters/CharacterRegistry";
import { ALLOWED_PFP_TYPES, MAX_PFP_BYTES } from "./constants";
import { PFP_PRESETS } from "./pfpCatalog";
import AvatarPreview from "./AvatarPreview";

type AvatarPickerProps = {
  selectedPresetId?: PfpPresetId | null;
  customAvatarUrl?: string | null;
  selectedCharacterId?: CharacterId;
  mode?: "guest" | "auth";
  busy?: boolean;
  error?: string | null;
  className?: string;
  onPresetSelect?: (id: PfpPresetId) => void | Promise<void>;
  onCustomUpload?: (file: File) => void | Promise<void>;
  onCharacterSelect?: (id: CharacterId) => void | Promise<void>;
};

function cssColor(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

export default function AvatarPicker({
  selectedPresetId,
  customAvatarUrl,
  selectedCharacterId,
  mode = "auth",
  busy = false,
  error = null,
  className = "",
  onPresetSelect,
  onCustomUpload,
  onCharacterSelect,
}: AvatarPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const notice = error ?? localError;

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !onCustomUpload) return;
    if (!(ALLOWED_PFP_TYPES as readonly string[]).includes(file.type)) {
      setLocalError("Use a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > MAX_PFP_BYTES) {
      setLocalError("Image must be under 2 MB.");
      return;
    }
    setLocalError(null);
    await onCustomUpload(file);
  };

  return (
    <div className={`broadcast-panel space-y-5 rounded-2xl p-5 ${className}`}>
      <div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="mono text-[9px] uppercase tracking-[0.24em] text-gold">Profile image</p>
            <h2 className="mt-1 text-lg font-semibold text-bone">Choose your broadcast face</h2>
          </div>
          <AvatarPreview src={customAvatarUrl ?? PFP_PRESETS.find((preset) => preset.id === selectedPresetId)?.src} label="You" />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-dim">
          {mode === "guest" ? "Guest images stay in this browser until cleared." : "Uploads are saved to your profile."}
        </p>
      </div>

      {notice && <p className="border border-red/40 px-3 py-2 text-xs text-red">{notice}</p>}

      <div className="scroll-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {PFP_PRESETS.map((preset) => {
          const active = !customAvatarUrl && selectedPresetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              disabled={busy || !onPresetSelect}
              onClick={() => void onPresetSelect?.(preset.id)}
              className={`w-20 shrink-0 border p-2 text-center transition ${active ? "border-gold bg-gold/10 text-bone" : "border-bone/15 text-dim hover:border-neon/50 hover:text-bone"} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <AvatarPreview src={preset.src} label={preset.label} size="sm" className="mx-auto" />
              <span className="mono mt-2 block text-[9px] uppercase tracking-[0.14em]">{preset.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          disabled={busy || !onCustomUpload}
          onClick={() => inputRef.current?.click()}
          className="w-20 shrink-0 border border-dashed border-bone/20 p-2 text-center text-[10px] uppercase tracking-[0.12em] text-dim transition hover:border-neon/50 hover:text-bone disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="mx-auto grid h-9 w-9 place-items-center border border-bone/20 text-lg">+</span>
          <span className="mono mt-2 block text-[9px]">Upload</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_PFP_TYPES.join(",")}
          className="hidden"
          onChange={(event) => void handleFile(event)}
        />
      </div>

      <div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="mono text-[9px] uppercase tracking-[0.24em] text-gold">3D avatar</p>
            <h2 className="mt-1 text-lg font-semibold text-bone">Choose your arena body</h2>
          </div>
          <span className="mono text-[10px] uppercase tracking-[0.14em] text-dim">{selectedCharacterId ?? "none"}</span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
          {CHARACTER_IDS.map((id) => {
            const spec = CHARACTER_REGISTRY[id];
            const active = selectedCharacterId === id;
            const color = cssColor(spec.palette.primary);
            const accent = cssColor(spec.palette.accent);
            return (
              <button
                key={id}
                type="button"
                disabled={busy || !onCharacterSelect}
                onClick={() => void onCharacterSelect?.(id)}
                title={spec.name}
                className={`border p-1 transition ${active ? "border-gold" : "border-bone/15 hover:border-neon/50"} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <span
                  className="grid aspect-square place-items-center"
                  style={{ background: `linear-gradient(145deg, ${color}, ${accent})` }}
                >
                  <span className="font-display text-xs text-void">{spec.name.slice(0, 2).toUpperCase()}</span>
                </span>
                <span className="mono mt-1 block truncate text-[8px] uppercase tracking-[0.1em] text-dim">{id}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
