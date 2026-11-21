"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Arena, CrossEvent, DealerClue, DealerNudge, Dice, Direction, NexusReport, Player, PuzzleResult, PuzzleSnapshot, Role, RoundView, Snapshot, Status, Visions, Wristband, You,
} from "./types";
import { appCheckToken, getFirebaseAuth } from "./firebase";
import { guest } from "./guest";

export type RoundTransition = {
  id: number;
  round: number;
  moved: { from: [number, number]; to: [number, number]; code_from: string; code_to: string }[];
  sigils: string[];
  patternType: string | null;
  previous: Arena | null;
};

export type ChatLine = { from: string; color: string; text: string };

export type DoorEvent = {
  id: number;
  type: "door_result" | "door_opened" | "door_closed" | "lockdown";
  accepted: boolean;
  locked?: boolean;
  door?: string;
  color?: string;
  room_code?: string;
  target_code?: string;
  message?: string;
  cost?: number;
};

export type HazardEvent = { player: string; room_code: string; penalty: number; points: number };
export type ReviveEvent = { player: string; by: string[]; points: Record<string, number> };
export type EliminationEvent = { player: string; reason: string };

const EMPTY_NEXUS: NexusReport = {
  team_skill: 0, difficulty: 0, complexity_level: 0, players: [], last_action: null,
};
const FATAL_ERRORS = new Set([
  "auth_required", "auth_invalid", "auth_timeout", "auth_unavailable",
  "admin_required", "room_full", "game_started", "server_full",
]);

function socketUrl(room: string, name: string, pid: string) {
  const origin = window.location.origin;
  let base: URL;
  try {
    const configured = process.env.WS_URL?.trim();
    base = new URL(configured || origin, origin);
    if (!/^(ws|wss|http|https):$/.test(base.protocol)) throw new Error("Invalid WS URL");
  } catch {
    base = new URL(origin);
  }
  base.protocol =
    window.location.protocol === "https:" || base.protocol === "https:" || base.protocol === "wss:"
      ? "wss:"
      : "ws:";
  base.hash = "";
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/ws/${encodeURIComponent(room)}`;
  base.searchParams.set("name", name);
  base.searchParams.set("auth", "1");
  if (pid) base.searchParams.set("pid", pid);
  return base.toString();
}

export function useGameSocket(room: string, name: string) {
  const [connected, setConnected] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [you, setYou] = useState<string | null>(null);
  const [arena, setArena] = useState<Arena | null>(null);
  const [prevArena, setPrevArena] = useState<Arena | null>(null);
  const [wristband, setWristband] = useState<Wristband | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [status, setStatus] = useState<Status>("lobby");
  const [round, setRound] = useState(0);
  const [maxRounds, setMaxRounds] = useState(15);
  const [stage, setStage] = useState(1);
  const [stageName, setStageName] = useState("Induction");
  const [maxStage, setMaxStage] = useState(7);
  const [ruleCount, setRuleCount] = useState(1);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [roundSeconds, setRoundSeconds] = useState(20);
  const [matchAt, setMatchAt] = useState<number | null>(null);
  const [matchSeconds, setMatchSeconds] = useState(300);
  const [minPlayers, setMinPlayers] = useState(1);
  const [nexus, setNexus] = useState<NexusReport>(EMPTY_NEXUS);
  const [pa, setPa] = useState("The Last Room is open. Find the hidden exit.");
  const [role, setRole] = useState<Role | null>(null);
  const [roleLabel, setRoleLabel] = useState("Assigning role");
  const [roleHint, setRoleHint] = useState("Waiting for the Dealer to assign your role.");
  const [me, setMe] = useState<You | null>(null);
  const [dice, setDice] = useState<Dice>({});
  const [futures, setFutures] = useState<Visions>({});
  const [transition, setTransition] = useState<RoundTransition>({
    id: 0, round: 0, moved: [], sigils: [], patternType: null, previous: null,
  });
  const [prediction, setPrediction] = useState<{ correct: boolean; score: number; message: string } | null>(null);
  const [doorEvent, setDoorEvent] = useState<DoorEvent | null>(null);
  const [cross, setCross] = useState<CrossEvent>({
    id: 0, door: null, from: null, to: null, cost: 0, player: null,
  });
  const [hazard, setHazard] = useState<HazardEvent | null>(null);
  const [revive, setRevive] = useState<ReviveEvent | null>(null);
  const [eliminated, setEliminated] = useState<EliminationEvent | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [exitNotice, setExitNotice] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState<{ won: boolean; summary: any } | null>(null);
  const [dealerClue, setDealerClue] = useState<DealerClue | null>(null);
  const [dealerNudge, setDealerNudge] = useState<DealerNudge | null>(null);
  const [puzzle, setPuzzle] = useState<PuzzleSnapshot | null>(null);
  const [puzzleResult, setPuzzleResult] = useState<PuzzleResult | null>(null);
  const [sanctionTotal, setSanctionTotal] = useState(0);
  const [sanctionFound, setSanctionFound] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const youRef = useRef<string | null>(null);

  useEffect(() => {
    if (!dealerClue) return;
    const timer = window.setTimeout(() => setDealerClue(null), 8000);
    return () => window.clearTimeout(timer);
  }, [dealerClue]);

  useEffect(() => {
    if (!dealerNudge) return;
    const timer = window.setTimeout(() => setDealerNudge(null), 8000);
    return () => window.clearTimeout(timer);
  }, [dealerNudge]);

  useEffect(() => {
    if (!puzzleResult) return;
    const timer = window.setTimeout(() => setPuzzleResult(null), 8000);
    return () => window.clearTimeout(timer);
  }, [puzzleResult]);

  useEffect(() => {
    let disposed = false;
    let attempts = 0;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let restoredTimer: number | null = null;
    let fatalClose = false;
    let hadConnected = false;

    const apply = (s: Snapshot) => {
      setArena(s.arena);
      setWristband(s.wristband ?? null);
      setPlayers(s.players);
      setMe(s.you);
      if (s.you?.id) youRef.current = s.you.id;
      setStatus(s.status);
      setRound(s.round ?? 0);
      setMaxRounds(s.max_rounds ?? 15);
      setStage(s.stage);
      setStageName(s.stage_name);
      setMaxStage(s.max_stage);
      setRuleCount(s.rule_count);
      setSanctionTotal(s.sanction_total ?? 0);
      setSanctionFound(s.sanction_found ?? 0);
      setMinPlayers(s.min_players);
      setRoundSeconds(s.round_seconds ?? 20);
      setMatchSeconds(s.match_seconds ?? 300);
      setMatchAt(s.match_time_left != null ? performance.now() + s.match_time_left * 1000 : null);
      setNexus(s.nexus ?? EMPTY_NEXUS);
      setPa(s.pa ?? "");
      setRole(s.role);
      setRoleLabel(s.role_label);
      setRoleHint(s.role_hint);
      setDice(s.dice ?? {});
      setFutures(s.futures ?? {});
      setPuzzle(s.puzzle ?? null);
      setNextAt(s.next_round_in != null ? performance.now() + s.next_round_in * 1000 : null);
    };

    const scheduleReconnect = () => {
      if (disposed || fatalClose) return;
      const delay = Math.min(15000, 1000 * 2 ** attempts);
      attempts += 1;
      setAttempts(attempts);
      reconnectTimer = window.setTimeout(connect, delay);
    };

    const connect = () => {
      if (disposed) return;
      let storedId = "";
      try {
        storedId = sessionStorage.getItem(`axiom_pid_${room}`) || "";
      } catch {
        storedId = "";
      }
      let ws: WebSocket;
      try {
        ws = new WebSocket(socketUrl(room, name, storedId));
      } catch {
        setError("Cannot reach the game server. Retrying…");
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        attempts = 0;
        setAttempts(0);
        setConnected(true);
        setError(null);
        if (hadConnected) {
          setRestored(true);
          if (restoredTimer !== null) window.clearTimeout(restoredTimer);
          restoredTimer = window.setTimeout(() => setRestored(false), 3200);
        }
        hadConnected = true;
        void (async () => {
          let idToken: string | null = null;
          try {
            idToken = (await getFirebaseAuth().currentUser?.getIdToken()) ?? null;
          } catch {
            idToken = null;
          }
          const appCheck = await appCheckToken();
          if (ws.readyState !== WebSocket.OPEN) return;
          if (!idToken) guest.clearAvatar();
          ws.send(JSON.stringify({
            type: "auth",
            token: idToken,
            app_check: appCheck,
            name,
            pid: storedId || undefined,
          }));
        })();
        heartbeatTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
        }, 25000);
      };

      ws.onclose = () => {
        setConnected(false);
        if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
        scheduleReconnect();
      };

      ws.onerror = () => {
        if (!fatalClose) setError("Cannot reach the game server. Retrying…");
      };

      ws.onmessage = (e) => {
        let m: any;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.type === "welcome") {
          setYou(m.you);
          youRef.current = m.you;
          try {
            sessionStorage.setItem(`axiom_pid_${room}`, m.you);
          } catch {}
          apply(m.state);
        } else if (m.type === "state") {
          apply(m.state);
        } else if (m.type === "players") {
          setPlayers(m.players);
          setStatus(m.status);
          if (m.status !== "running") setNextAt(null);
        } else if (m.type === "round") {
          const tv = m as RoundView;
          if (tv.arena) setArena(tv.arena);
          if (tv.previous) setPrevArena(tv.previous);
          if (tv.players) setPlayers(tv.players);
          setTransition((t) => ({
            id: t.id + 1,
            round: tv.round,
            moved: (tv.moved ?? []).map((x) => ({
              from: x.from, to: x.to, code_from: x.code_from, code_to: x.code_to,
            })),
            sigils: tv.sigils ?? [],
            patternType: tv.pattern_type,
            previous: tv.previous ?? null,
          }));
          setRound(tv.round);
          if (tv.pa) setPa(tv.pa);
          if (tv.dice) setDice(tv.dice);
          if (tv.futures) setFutures(tv.futures);
          if (tv.next_round_in != null) setNextAt(performance.now() + tv.next_round_in * 1000);
          if (tv.state) apply(tv.state);
        } else if (m.type === "door_result") {
          const cost = Number(m.cost ?? 1) || 1;
          setDoorEvent((prev) => ({
            id: (prev?.id ?? 0) + 1, type: "door_result",
            accepted: !!m.accepted, locked: m.locked, door: m.door, color: m.color,
            room_code: m.room_code, target_code: m.target_code,
            message: m.message, cost,
          }));
        } else if (m.type === "door_opened") {
          setDoorEvent((prev) => ({
            id: (prev?.id ?? 0) + 1, type: "door_opened",
            accepted: !!m.accepted, door: m.door, color: m.color,
            room_code: m.room_code, target_code: m.target_code,
            cost: Number(m.cost ?? 1) || 1, message: m.message,
          }));
        } else if (m.type === "door_closed") {
          setDoorEvent((prev) => ({
            id: (prev?.id ?? 0) + 1, type: "door_closed", accepted: false,
            door: m.door, room_code: m.room_code, target_code: m.target_code, message: m.message,
          }));
        } else if (m.type === "room_entered") {
          setCross((prev) => ({
            id: prev.id + 1,
            door: (m.door as Direction) ?? null,
            from: m.from ?? null,
            to: m.to ?? null,
            cost: Number(m.cost ?? 0) || 0,
            player: m.player ?? null,
          }));
        } else if (m.type === "lockdown") {
          setDoorEvent((prev) => ({
            id: (prev?.id ?? 0) + 1, type: "lockdown", accepted: false, locked: true,
            door: m.door, room_code: m.room_code, message: m.message,
          }));
        } else if (m.type === "hazard") {
          setHazard({ player: m.player, room_code: m.room_code, penalty: m.penalty, points: m.points });
        } else if (m.type === "dealer_clue") {
          setDealerClue((prev) => ({
            id: (prev?.id ?? 0) + 1,
            tier: Number(m.tier) === 1 ? 1 : 2,
            text: String(m.text ?? ""),
          }));
        } else if (m.type === "dealer_nudge") {
          setDealerNudge({
            role: m.role,
            text: String(m.text ?? ""),
            puzzle: m.puzzle ? String(m.puzzle) : undefined,
            round: Number(m.round) || 0,
          });
        } else if (m.type === "puzzle_result") {
          setPuzzleResult({
            correct: !!m.correct,
            attempts: Number(m.attempts) || 0,
            points: Number(m.points) || 0,
            complete: !!m.complete,
            marks: Number(m.marks) || 0,
            code: m.code ? String(m.code) : undefined,
            message: m.message ? String(m.message) : undefined,
          });
        } else if (m.type === "revive") {
          setRevive({ player: m.player, by: m.by, points: m.points });
        } else if (m.type === "elimination") {
          setEliminated({ player: m.player, reason: m.reason });
        } else if (m.type === "prediction_result") {
          setPrediction({ correct: m.correct, score: m.score, message: m.message });
        } else if (m.type === "exit_found") {
          setExitNotice(m.message ?? "EXIT SIGHTED. TELL YOUR TEAM.");
        } else if (m.type === "time_up") {
          setMatchAt(null);
          setPa(m.message ?? "TIME EXPIRED. THE TEAM WAS ELIMINATED.");
        } else if (m.type === "chat") {
          setChat((c) => [...c, { from: m.from, color: m.color, text: m.text }].slice(-60));
        } else if (m.type === "game_over") {
          setGameOver({ won: m.won, summary: m.summary });
          setStatus(m.won ? "won" : "over");
        } else if (m.type === "error") {
          setError(m.message || m.code);
          if (FATAL_ERRORS.has(m.code)) {
            fatalClose = true;
            ws.close();
          }
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      if (restoredTimer !== null) window.clearTimeout(restoredTimer);
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      wsRef.current = null;
    };
  }, [room, name]);

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }, []);

  const sendOpenDoor = useCallback((door: string) => send({ type: "open_door", door }), [send]);
  const sendCrossDoor = useCallback((door: string) => send({ type: "cross_door", door }), [send]);
  const sendWait = useCallback(() => send({ type: "wait" }), [send]);
  const sendUnlock = useCallback((target: string) => send({ type: "unlock", target }), [send]);
  const sendPredict = useCallback(
    (pattern_type?: string, sigils?: string[]) => send({ type: "predict", pattern_type, sigils }),
    [send]
  );
  const sendReady = useCallback((value: boolean) => send({ type: "ready", value }), [send]);
  const sendChat = useCallback((text: string) => send({ type: "chat", text }), [send]);
  const sendPuzzleMark = useCallback(
    (role: Role, value: string) => send({ type: "puzzle_submit", assignment: { [role]: value } }),
    [send],
  );

  return {
    connected, attempts, restored, error, you, me, arena, prevArena, wristband, players, status, round, maxRounds, stage,
    stageName, maxStage, ruleCount, nextAt, roundSeconds, matchAt, matchSeconds, minPlayers, nexus, pa, role, roleLabel,
    roleHint, dice, futures, transition, prediction, doorEvent, cross,
    hazard, revive, eliminated, chat, exitNotice, gameOver,
    dealerClue, dealerNudge, puzzle, puzzleResult, sanctionTotal, sanctionFound,
    sendOpenDoor, sendCrossDoor, sendWait, sendUnlock, sendPredict, sendReady, sendChat,
    sendPuzzleMark,
  };
}
