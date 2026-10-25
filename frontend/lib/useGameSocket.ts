"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Maze, NexusReport, Player, Puzzle, Role, Snapshot, Status, TransitionView } from "./types";

export type Transition = {
  id: number;
  cycle: number;
  moved: { bx: number; by: number; symbol?: string }[];
  symbols: string[];
  patternType: string | null;
  previous: Maze | null;
};

export type ChatLine = { from: string; color: string; text: string };

const EMPTY_NEXUS: NexusReport = {
  team_skill: 0, difficulty: 0, complexity_level: 0, players: [], last_action: null,
};

export function useGameSocket(room: string, name: string) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [you, setYou] = useState<string | null>(null);
  const [maze, setMaze] = useState<Maze | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [status, setStatus] = useState<Status>("lobby");
  const [cycle, setCycle] = useState(0);
  const [stage, setStage] = useState(1);
  const [stageName, setStageName] = useState("Introduction");
  const [maxStage, setMaxStage] = useState(7);
  const [ruleCount, setRuleCount] = useState(1);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [transitionSeconds, setTransitionSeconds] = useState(12);
  const [minPlayers, setMinPlayers] = useState(1);
  const [nexus, setNexus] = useState<NexusReport>(EMPTY_NEXUS);
  const [nexusMessage, setNexusMessage] = useState("NEXUS is watching.");
  const [role, setRole] = useState<Role>("mover");
  const [roleLabel, setRoleLabel] = useState("Mover");
  const [roleHint, setRoleHint] = useState("");
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [transition, setTransition] = useState<Transition>({
    id: 0, cycle: 0, moved: [], symbols: [], patternType: null, previous: null,
  });
  const [prediction, setPrediction] = useState<{ correct: boolean; score: number; message: string } | null>(null);
  const [puzzleResult, setPuzzleResult] = useState<boolean | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [teamNotes, setTeamNotes] = useState<{ from: string; role: string; text: string }[]>([]);
  const [gameOver, setGameOver] = useState<{ won: boolean; summary: any } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";
    const storedId = sessionStorage.getItem(`axiom_pid_${room}`) || "";
    const url = `${base}/ws/${encodeURIComponent(room)}?name=${encodeURIComponent(name)}${storedId ? `&pid=${storedId}` : ""}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    const apply = (s: Snapshot) => {
      setMaze(s.maze);
      setPlayers(s.players);
      setStatus(s.status);
      setCycle(s.cycle);
      setStage(s.stage);
      setStageName(s.stage_name);
      setMaxStage(s.max_stage);
      setRuleCount(s.rule_count);
      setMinPlayers(s.min_players);
      setTransitionSeconds(s.transition_seconds);
      setNexus(s.nexus ?? EMPTY_NEXUS);
      setNexusMessage(s.nexus_message ?? "NEXUS is watching.");
      setRole(s.role);
      setRoleLabel(s.role_label);
      setRoleHint(s.role_hint);
      setNextAt(s.next_transition_in != null ? performance.now() + s.next_transition_in * 1000 : null);
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
      } else if (m.type === "transition") {
        const tv = m as TransitionView & { maze: Maze; players: Player[]; next_transition_in: number; state: Snapshot };
        setMaze(tv.maze);
        setPrevMaze(tv.previous ?? tv.maze);
        setPlayers(tv.players);
        setTransition((t) => ({
          id: t.id + 1,
          cycle: tv.cycle,
          moved: tv.moved ?? [],
          symbols: tv.symbols ?? [],
          patternType: tv.pattern_type,
          previous: tv.previous ?? null,
        }));
        setCycle(tv.cycle);
        if (tv.puzzle !== undefined) setPuzzle(tv.puzzle ?? null);
        if (tv.nexus_message) setNexusMessage(tv.nexus_message);
        setNextAt(performance.now() + tv.next_transition_in * 1000);
        if (tv.state) apply(tv.state);
      } else if (m.type === "prediction_result") {
        setPrediction({ correct: m.correct, score: m.score, message: m.message });
      } else if (m.type === "puzzle_result") {
        setPuzzleResult(m.correct);
      } else if (m.type === "chat") {
        setChat((c) => [...c, { from: m.from, color: m.color, text: m.text }].slice(-60));
      } else if (m.type === "team_note") {
        setTeamNotes((n) => [...n, { from: m.from, role: m.role, text: m.text }].slice(-40));
      } else if (m.type === "game_over") {
        setGameOver({ won: m.won, summary: m.summary });
      } else if (m.type === "error") {
        setError(m.message);
      }
    };
    return () => ws.close();
  }, [room, name]);

  const [prevMaze, setPrevMaze] = useState<Maze | null>(null);

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }, []);

  const sendMove = useCallback((dx: number, dy: number) => send({ type: "move", dx, dy }), [send]);
  const sendPredict = useCallback(
    (pattern_type?: string, symbols?: string[]) => send({ type: "predict", pattern_type, symbols }),
    [send]
  );
  const sendReady = useCallback((value: boolean) => send({ type: "ready", value }), [send]);
  const sendPuzzle = useCallback((choice: number) => send({ type: "puzzle_answer", choice }), [send]);
  const sendChat = useCallback((text: string) => send({ type: "chat", text }), [send]);
  const sendClue = useCallback((roleName: string, text: string) => send({ type: "clue_share", role: roleName, text }), [send]);

  return {
    connected, error, you, maze, prevMaze, players, status, cycle, stage, stageName, maxStage,
    ruleCount, nextAt, transitionSeconds, minPlayers, nexus, nexusMessage, role, roleLabel,
    roleHint, puzzle, transition, prediction, puzzleResult, chat, teamNotes, gameOver,
    sendMove, sendPredict, sendReady, sendPuzzle, sendChat, sendClue,
  };
}
