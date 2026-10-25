export type Symbol = "triangle" | "circle" | "square";
export type Role = "mover" | "symbolist" | "chronologist" | "archivist";
export type PatternType =
  | "rotation" | "reflection" | "translation"
  | "symbol" | "sequential" | "conditional" | "compound";

export type Block = {
  bx: number;
  by: number;
  symbol: Symbol;
  material: "stone" | "glass" | "rune";
  openings: string[];
};

export type Maze = {
  size: number;
  block: number;
  tile_size: number;
  tiles: string[]; // rows of "#" (wall) and "." (open)
  blocks: Block[];
  start: [number, number];
  exit: [number, number];
};

export type Player = {
  id: string;
  name: string;
  slot: number;
  color: string;
  role: Role;
  x: number;
  y: number;
  escaped: boolean;
  ready: boolean;
  connected: boolean;
  correct: number;
  predictions: number;
  streak: number;
};

export type Status = "lobby" | "running" | "won" | "over";

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

export type Snapshot = {
  room: string;
  status: Status;
  cycle: number;
  stage: number;
  stage_name: string;
  max_stage: number;
  maze: Maze;
  players: Player[];
  next_transition_in: number | null;
  transition_seconds: number;
  min_players: number;
  rule_count: number;
  nexus: NexusReport;
  nexus_message: string;
  puzzle: Puzzle | null;
  role: Role;
  role_label: string;
  role_hint: string;
};

export type TransitionView = {
  type: "transition";
  cycle: number;
  pattern_type: PatternType | null;
  active: boolean;
  moved: { bx: number; by: number; symbol?: Symbol }[];
  symbols?: Symbol[];
  timing?: { next_in: number };
  previous?: Maze;
  puzzle?: Puzzle | null;
  nexus_message?: string;
};
