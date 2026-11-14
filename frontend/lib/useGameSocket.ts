"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Arena, Dice, NexusReport, Player, Puzzle, Role, RoundView, Snapshot, Status, Visions, You,
} from "./types";

export type RoundTransition = {
  id: number;
  round: number;
  moved: { from: [number, number]; to: [number, number]; code_from: string; code_to: string }[];
  sigils: string[];
  patternType: string | null;
  previous: Arena | null;
};

export type ChatLine = { from: string; color: string; text: string };
export type TeamNote = { from: string; role: string; text: string };

export type DoorEvent = {
  accepted: boolean;
  locked?: boolean;
  door?: string;
  color?: string;
  remaining?: number;
  room_code?: string;
  target_code?: string;
  message?: string;
};

export type HazardEvent = { player: string; room_code: string; penalty: number; points: number };
export type ReviveEvent = { player: string; by: string[]; points: Record<string, number> };
export type EliminationEvent = { player: string; reason: string };

const EMPTY_NEXUS: NexusReport = {
  team_skill: 0, difficulty: 0, complexity_level: 0, players: [], last_action: null,
};

export function useGameSocket(room: string, name: string) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [you, setYou] = useState<string | null>(null);
  const [arena, setArena] = useState<Arena | null>(null);
  const [prevArena, setPrevArena] = useState<Arena | null>(null);
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
  const [minPlayers, setMinPlayers] = useState(1);
  const [nexus, setNexus] = useState<NexusReport>(EMPTY_NEXUS);
  const [pa, setPa] = useState("The Last Room is open. Find the final door.");
  const [role, setRole] = useState<Role>("navigator");
  const [roleLabel, setRoleLabel] = useState("Navigator");
  const [roleHint, setRoleHint] = useState("");
  const [me, setMe] = useState<You | null>(null);
  const [dice, setDice] = useState<Dice>({});
  const [futures, setFutures] = useState<Visions>({});
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [exitUnsealed, setExitUnsealed] = useState(false);
  const [transition, setTransition] = useState<RoundTransition>({
    id: 0, round: 0, moved: [], sigils: [], patternType: null, previous: null,
  });
  const [prediction, setPrediction] = useState<{ correct: boolean; score: number; message: string } | null>(null);
  const [puzzleResult, setPuzzleResult] = useState<boolean | null>(null);
  const [doorEvent, setDoorEvent] = useState<DoorEvent | null>(null);
  const [hazard, setHazard] = useState<HazardEvent | null>(null);
  const [revive, setRevive] = useState<ReviveEvent | null>(null);
  const [eliminated, setEliminated] = useState<EliminationEvent | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [teamNotes, setTeamNotes] = useState<TeamNote[]>([]);
  const [exitNotice, setExitNotice] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState<{ won: boolean; summary: any } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";
    const storedId = sessionStorage.getItem(`axiom_pid_${room}`) || "";
    const url = `${base}/ws/${encodeURIComponent(room)}?name=${encodeURIComponent(name)}${storedId ? `&pid=${storedId}` : ""}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    const apply = (s: Snapshot) => {
      setArena(s.arena);
      setPlayers(s.players);
      setMe(s.you);
      setStatus(s.status);
      setRound(s.round ?? 0);
      setMaxRounds(s.max_rounds ?? 15);
      setStage(s.stage);
      setStageName(s.stage_name);
      setMaxStage(s.max_stage);
      setRuleCount(s.rule_count);
      setMinPlayers(s.min_players);
      setRoundSeconds(s.round_seconds ?? 20);
      setNexus(s.nexus ?? EMPTY_NEXUS);
      setPa(s.pa ?? "");
      setRole(s.role);
      setRoleLabel(s.role_label);
      setRoleHint(s.role_hint);
      setDice(s.dice ?? {});
      setFutures(s.futures ?? {});
      setExitUnsealed(!!s.exit_unsealed);
      if (s.puzzle !== undefined) setPuzzle(s.puzzle ?? null);
      setNextAt(s.next_round_in != null ? performance.now() + s.next_round_in * 1000 : null);
    };

    ws.onopen = () => { setConnected(true); setError(null); };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setError("Cannot reach the game server. Is the backend running on port 8000?");
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "welcome") {
        setYou(m.you);
        sessionStorage.setItem(`axiom_pid_${room}`, m.you);
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
        setPlayers(tv.players);
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
        setExitUnsealed(!!tv.exit_unsealed);
        if (tv.dice) setDice(tv.dice);
        if (tv.futures) setFutures(tv.futures);
        if (tv.puzzle !== undefined) setPuzzle(tv.puzzle ?? null);
        setNextAt(performance.now() + tv.next_round_in * 1000);
        if (tv.state) apply(tv.state);
      } else if (m.type === "door_result") {
        setDoorEvent({
          accepted: !!m.accepted, locked: m.locked, door: m.door, color: m.color,
          remaining: m.remaining, room_code: m.room_code, target_code: m.target_code,
          message: m.message,
        });
      } else if (m.type === "lockdown") {
        setDoorEvent({ accepted: false, locked: true, door: m.door, room_code: m.room_code, message: m.message });
      } else if (m.type === "hazard") {
        setHazard({ player: m.player, room_code: m.room_code, penalty: m.penalty, points: m.points });
      } else if (m.type === "revive") {
        setRevive({ player: m.player, by: m.by, points: m.points });
      } else if (m.type === "elimination") {
        setEliminated({ player: m.player, reason: m.reason });
      } else if (m.type === "prediction_result") {
        setPrediction({ correct: m.correct, score: m.score, message: m.message });
      } else if (m.type === "puzzle_result") {
        setPuzzleResult(m.correct);
      } else if (m.type === "exit_unsealed") {
        setExitUnsealed(true);
        setExitNotice(m.message ?? "The final door is unsealed.");
      } else if (m.type === "chat") {
        setChat((c) => [...c, { from: m.from, color: m.color, text: m.text }].slice(-60));
      } else if (m.type === "team_note") {
        setTeamNotes((n) => [...n, { from: m.from, role: m.role, text: m.text }].slice(-40));
      } else if (m.type === "game_over") {
        setGameOver({ won: m.won, summary: m.summary });
        setStatus(m.won ? "won" : "over");
      } else if (m.type === "error") {
        setError(m.message);
      }
    };
    return () => ws.close();
  }, [room, name]);

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }, []);

  const sendChooseDoor = useCallback((door: string) => send({ type: "choose_door", door }), [send]);
  const sendWait = useCallback(() => send({ type: "wait" }), [send]);
  const sendUnlock = useCallback((target: string) => send({ type: "unlock", target }), [send]);
  const sendPredict = useCallback(
    (pattern_type?: string, sigils?: string[]) => send({ type: "predict", pattern_type, sigils }),
    [send]
  );
  const sendReady = useCallback((value: boolean) => send({ type: "ready", value }), [send]);
  const sendPuzzle = useCallback((choice: number) => send({ type: "puzzle_answer", choice }), [send]);
  const sendChat = useCallback((text: string) => send({ type: "chat", text }), [send]);
  const sendClue = useCallback((roleName: string, text: string) => send({ type: "clue_share", role: roleName, text }), [send]);

  return {
    connected, error, you, me, arena, prevArena, players, status, round, maxRounds, stage,
    stageName, maxStage, ruleCount, nextAt, roundSeconds, minPlayers, nexus, pa, role, roleLabel,
    roleHint, dice, futures, puzzle, exitUnsealed, transition, prediction, puzzleResult, doorEvent,
    hazard, revive, eliminated, chat, teamNotes, exitNotice, gameOver,
    sendChooseDoor, sendWait, sendUnlock, sendPredict, sendReady, sendPuzzle, sendChat, sendClue,
  };
}
