export type DoorColor = "red" | "blue" | "yellow" | "green";
export type Sigil = "spade" | "heart" | "diamond" | "club";
export type Role = "pathfinder" | "watcher" | "timekeeper" | "decoder";
export type Direction = "N" | "E" | "S" | "W";
export type PatternType =
  | "rotation" | "reflection" | "translation"
  | "symbol" | "sequential" | "conditional" | "compound";
export type Status = "lobby" | "running" | "won" | "over";
export type DealerClue = { id: number; tier: 1 | 2; text: string };
export type PuzzleView = { role: Role; domain: string[]; clues: string[] };
export type PuzzleSnapshot = {
  public: {
    seed?: number;
    difficulty?: string;
    complexity?: number;
    variables?: number;
    constraints?: number;
    attempts?: number;
    solved?: boolean;
  };
  you: PuzzleView | null;
};
export type PuzzleResult = {
  correct: boolean;
  attempts: number;
  points: number;
  complete: boolean;
  marks: number;
  code?: string;
  message?: string;
};
export type DealerNudge = { role: Role; text: string; puzzle?: string; round: number };

export type DelayTier = 1 | 2 | 3;
export type DelayCell = { row: number; col: number };
export type DelayKeyCell = DelayCell & { suit: Sigil };
export type DelayPuzzleView = {
  puzzle_id: string;
  tier: DelayTier;
  question: string;
  grids: {
    before?: Sigil[][];
    after?: Sigil[][];
    given?: (Sigil | null)[][];
  };
  highlight: DelayCell | null;
  answer_ms: number;
};
export type DelayKeyView = {
  puzzle_id: string;
  tier: DelayTier;
  key_text: string;
  key_cells?: DelayKeyCell[];
};
export type DelayStatusView = {
  state: "idle" | "cooldown" | "solving";
  cooldown_s: number;
  attempts_left: number;
};
export type DelayResultView = {
  ok: boolean;
  delta_s?: number;
  message?: string;
};

export type KingView = {
  id: string;
  appearance: number;
  room_id: string;
  room_code: string | null;
  room: [number, number] | null;
  started_at: number;
  ends_at: number;
  next_teleport_at: number;
  teleport_index: number;
  teleport_total: number;
  kill_count: number;
};

export type KingEvent = {
  id: number;
  type: "spawn" | "teleport" | "despawn" | "kill";
  king?: KingView | null;
  room_code?: string | null;
  room?: [number, number] | null;
  victim?: string;
  victim_name?: string;
  reason?: string;
};

export type KingWatchView = {
  id: string;
  appearance: number;
  total: number;
  in_seconds: number;
  starts_at: number;
  room_code: string | null;
  room: [number, number] | null;
};

export type CrossEvent = {
  id: number;
  door: Direction | null;
  from: string | null;
  to: string | null;
  cost: number;
  player: string | null;
};

export type Door = {
  color: DoorColor;
  open?: boolean;
  temporary_open?: boolean;
  open_until?: number | null;
};

export type ArenaRoom = {
  id: string;
  code: string;
  bx: number;
  by: number;
  sigil: Sigil | null;
  doors: Record<Direction, Door>;
  sanction: number | null;
  revealed: boolean;
  future: string | null;
  open: Record<Direction, boolean>;
};

export type Arena = {
  size: number;
  start_room: [number, number];
  rooms: ArenaRoom[];
};

export type You = {
  id: string;
  room_id: string;
  room_code: string | null;
  room: [number, number] | null;
  doors: Record<Direction, Door & { open: boolean }>;
  locked: boolean;
  eliminated: boolean;
  escaped: boolean;
  exit_found: boolean;
  exit_code: string | null;
  points: number;
  role: Role;
  wristband_revealed?: boolean;
  wristband_cooldown_remaining?: number;
};

export type Player = {
  id: string;
  name: string;
  slot: number;
  color: string;
  avatar_url: string | null;
  role: Role;
  room_id: string;
  room_code: string | null;
  room: [number, number] | null;
  escaped: boolean;
  ready: boolean;
  connected: boolean;
  correct: number;
  predictions: number;
  streak: number;
  points: number;
  locked: boolean;
  eliminated: boolean;
  waits: number;
  revives: number;
};

export type NexusPlayer = {
  pid: string;
  name: string;
  style: string;
  attrs: Record<string, number>;
  predictions: number;
  correct: number;
};

export type NexusReport = {
  team_skill: number;
  difficulty: number;
  complexity_level: number;
  players: NexusPlayer[];
  last_action: { action: string; utility: number; alternatives: Record<string, number> } | null;
};

export type VisionDoor = {
  future?: string;
  color?: DoorColor;
};
export type VisionRoom = {
  rid: string;
  sigil?: Sigil;
  doors: Partial<Record<Direction, VisionDoor>>;
};
export type Visions = Record<string, VisionRoom>;

export type Wristband = Record<string, Partial<Record<Direction, boolean>>>;

export type Snapshot = {
  room: string;
  status: Status;
  round: number;
  max_rounds: number;
  stage: number;
  stage_name: string;
  max_stage: number;
  arena: Arena;
  wristband?: Wristband;
  wristband_sanctions?: string[];
  players: Player[];
  you: You | null;
  next_round_in: number | null;
  round_seconds: number;
  match_time_left: number | null;
  match_seconds: number;
  min_players: number;
  rule_count: number;
  sanction_total: number;
  sanction_found: number;
  nexus: NexusReport;
  pa: string;
  futures: Visions;
  role: Role;
  role_label: string;
  role_hint: string;
  king?: KingView | null;
  king_watch?: KingWatchView | null;
  puzzle?: PuzzleSnapshot;
  delay_status?: DelayStatusView;
};

export type MovedRoom = {
  rid?: string;
  from: [number, number];
  to: [number, number];
  code_from: string;
  code_to: string;
  sigil?: Sigil;
};

export type RoundView = {
  type: "round";
  round: number;
  pattern_type: PatternType | null;
  active: boolean;
  pa: string;
  moved?: MovedRoom[];
  ops?: { kind: string; index?: number; direction?: number; axis?: string }[];
  sigils?: Sigil[];
  timing?: { next_in: number };
  futures?: Visions;
  previous?: Arena;
  state?: Snapshot;
  arena: Arena;
  players: Player[];
  next_round_in: number;
};
