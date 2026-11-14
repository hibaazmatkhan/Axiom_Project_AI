export type DoorColor = "red" | "blue" | "yellow" | "green";
export type Sigil = "spade" | "heart" | "diamond" | "club";
export type Role = "navigator" | "oracle" | "timekeeper" | "archivist";
export type Direction = "N" | "E" | "S" | "W";
export type PatternType =
  | "rotation" | "reflection" | "translation"
  | "symbol" | "sequential" | "conditional" | "compound";
export type Status = "lobby" | "running" | "won" | "over";

export type Door = {
  color: DoorColor;
  sealed: boolean;
  open?: boolean;
  capacity: number | null;
  roll: number | null;
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
  is_exit: boolean;
  future: string | null;
  open: Record<Direction, boolean>;
};

export type Arena = {
  size: number;
  start_room: [number, number];
  exit_room: [number, number];
  exit_unsealed: boolean;
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
  points: number;
  role: Role;
};

export type Player = {
  id: string;
  name: string;
  slot: number;
  color: string;
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

export type Puzzle = {
  question: string;
  options: string[];
  clues: string[];
};

export type DiceDoor = { color: DoorColor; roll: number; capacity: number };
export type DiceRoom = {
  room: string;
  rid: string;
  doors: Partial<Record<Direction, DiceDoor>>;
};
export type Dice = Record<string, DiceRoom>;

export type VisionDoor = {
  future?: string;
  color?: DoorColor;
  capacity?: number;
};
export type VisionRoom = {
  rid: string;
  sigil?: Sigil;
  doors: Partial<Record<Direction, VisionDoor>>;
};
export type Visions = Record<string, VisionRoom>;

export type Snapshot = {
  room: string;
  status: Status;
  round: number;
  max_rounds: number;
  stage: number;
  stage_name: string;
  max_stage: number;
  arena: Arena;
  players: Player[];
  you: You | null;
  next_round_in: number | null;
  round_seconds: number;
  min_players: number;
  rule_count: number;
  nexus: NexusReport;
  pa: string;
  dice: Dice;
  futures: Visions;
  puzzle: Puzzle | null;
  exit_unsealed: boolean;
  role: Role;
  role_label: string;
  role_hint: string;
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
  exit_unsealed: boolean;
  moved?: MovedRoom[];
  ops?: { kind: string; index?: number; direction?: number; axis?: string }[];
  sigils?: Sigil[];
  timing?: { next_in: number };
  dice?: Dice;
  futures?: Visions;
  previous?: Arena;
  state?: Snapshot;
  puzzle?: Puzzle | null;
  arena: Arena;
  players: Player[];
  next_round_in: number;
};
