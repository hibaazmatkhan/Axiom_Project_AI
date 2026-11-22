"use client";

type Cue = "step" | "door" | "lockdown" | "king" | "warning";
type HowlerModule = typeof import("howler");
type HowlInstance = InstanceType<HowlerModule["Howl"]>;
type AudioState = {
  Howler: HowlerModule["Howler"];
  sounds: Record<Cue, HowlInstance>;
};

let state: AudioState | null = null;
let loading: Promise<AudioState | null> | null = null;
let muted = false;
let kingActive = false;

const TAU = Math.PI * 2;
const SAMPLE_RATE = 22050;

function writeText(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

function edgeFade(duration: number, t: number) {
  return Math.min(1, Math.max(0, t / 0.012), Math.max(0, (duration - t) / 0.02));
}

function makeWavUrl(duration: number, sample: (t: number) => number) {
  const frames = Math.floor(duration * SAMPLE_RATE);
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  writeText(view, 0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  writeText(view, 8, "WAVE");
  writeText(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(view, 36, "data");
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i += 1) {
    const t = i / SAMPLE_RATE;
    const value = Math.max(-1, Math.min(1, sample(t)));
    view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

function buildSounds(HowlCtor: HowlerModule["Howl"]): Record<Cue, HowlInstance> {
  const stepDuration = 0.11;
  const step = makeWavUrl(stepDuration, (t) => {
    const env = Math.exp(-t * 34) * edgeFade(stepDuration, t);
    const noise = (Math.random() * 2 - 1) * 0.32;
    return (Math.sin(TAU * 72 * t) * 0.68 + noise) * env * 0.72;
  });

  const doorDuration = 0.28;
  const door = makeWavUrl(doorDuration, (t) => {
    const env = Math.exp(-t * 11) * edgeFade(doorDuration, t);
    const metal = Math.sin(TAU * 410 * t) * 0.5 + Math.sin(TAU * 617 * t) * 0.3;
    const noise = (Math.random() * 2 - 1) * 0.24 * Math.exp(-t * 18);
    return (metal + noise) * env * 0.7;
  });

  const lockdownDuration = 0.72;
  const lockdown = makeWavUrl(lockdownDuration, (t) => {
    const env = Math.exp(-t * 4.6) * edgeFade(lockdownDuration, t);
    const phase = TAU * (110 * t + (260 / 7) * (1 - Math.exp(-7 * t)));
    const sweep = Math.sin(phase) * 0.55 + Math.sin(phase * 1.51) * 0.22;
    const clang = (Math.random() * 2 - 1) * 0.42 * Math.exp(-t * 22);
    return (sweep + clang) * env * 0.8;
  });

  const kingDuration = 1.6;
  const king = makeWavUrl(kingDuration, (t) => {
    const pulse = 0.5 + 0.5 * Math.sin(TAU * 1.15 * t);
    const drone = Math.sin(TAU * 46 * t) * 0.6 + Math.sin(TAU * 31 * t) * 0.34;
    const breath = (Math.random() * 2 - 1) * 0.09 * pulse;
    return (drone + breath) * (0.32 + 0.48 * pulse) * edgeFade(kingDuration, t) * 0.62;
  });

  const warningDuration = 0.92;
  const warning = makeWavUrl(warningDuration, (t) => {
    const beat = Math.min(2, Math.floor(t / 0.22));
    const within = (t % 0.22) / 0.22;
    const hz = [233, 311, 415][beat] ?? 415;
    const env = Math.exp(-within * 4.2) * edgeFade(warningDuration, t);
    return (Math.sin(TAU * hz * t) * 0.58 + Math.sin(TAU * hz * 1.5 * t) * 0.24) * env * 0.72;
  });

  return {
    step: new HowlCtor({ src: [step], format: ["wav"], volume: 0.2 }),
    door: new HowlCtor({ src: [door], format: ["wav"], volume: 0.3 }),
    lockdown: new HowlCtor({ src: [lockdown], format: ["wav"], volume: 0.45 }),
    king: new HowlCtor({ src: [king], format: ["wav"], loop: true, volume: 0.3 }),
    warning: new HowlCtor({ src: [warning], format: ["wav"], volume: 0.4 }),
  };
}

async function ensureAudio(): Promise<AudioState | null> {
  if (state) return state;
  if (loading) return loading;
  loading = (async () => {
    if (typeof window === "undefined") return null;
    const mod = await import("howler");
    mod.Howler.volume(0.85);
    mod.Howler.mute(muted);
    const next = { Howler: mod.Howler, sounds: buildSounds(mod.Howl) };
    state = next;
    return next;
  })();
  return loading;
}

export function unlockAudio() {
  if (typeof window === "undefined") return;
  void ensureAudio().then((audio) => {
    if (!audio) return;
    void audio.Howler.ctx?.resume();
  });
}

export function playSound(cue: Exclude<Cue, "king">) {
  if (muted) return;
  void ensureAudio().then((audio) => {
    if (!audio || muted) return;
    audio.sounds[cue].play();
  });
}

export function setKingProximity(active: boolean) {
  if (kingActive === active) return;
  kingActive = active;
  void ensureAudio().then((audio) => {
    if (!audio) return;
    const sound = audio.sounds.king;
    if (!active || muted) {
      sound.stop();
      return;
    }
    if (!sound.playing()) sound.play();
  });
}

export function setMuted(value: boolean) {
  muted = value;
  void ensureAudio().then((audio) => {
    if (!audio) return;
    audio.Howler.mute(value);
    if (value) {
      audio.sounds.king.stop();
      return;
    }
    if (kingActive && !audio.sounds.king.playing()) audio.sounds.king.play();
  });
}

export function stopSounds() {
  kingActive = false;
  void ensureAudio().then((audio) => {
    if (!audio) return;
    Object.values(audio.sounds).forEach((sound) => sound.stop());
  });
}
