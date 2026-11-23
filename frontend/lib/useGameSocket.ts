"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Arena, CrossEvent, DealerClue, DealerNudge, DelayKeyView, DelayPuzzleView, DelayResultView, DelayStatusView, Direction, KingEvent, KingView, KingWatchView, NexusReport, NoteLine, PatternType, Player, PlayerLeftEvent, PlayerMoveEvent, Pose, PuzzleResult, PuzzleSnapshot, Role, RoundView, Sigil, Snapshot, Status, Wristband, You,
} from "./types";
import { appCheckToken, getFirebaseAuth } from "./firebase";
import { guest } from "./guest";

export type RoundTransition = {
  id: number;
  round: number;
  moved: { from: [number, number]; to: [number, number]; code_from: string; code_to: string }[];
  sigils: string[];
  patternType: string | null;
  patternTypes: PatternType[] | null;
  previous: Arena | null;
};

export type ToastText = { id: number; text: string };
export type SealedAlert = {
  id: number;
  message: string;
  door?: string;
  room_code?: string;
  points?: number;
  sealed_strikes?: number;
};

export type DoorEvent = {
  id: number;
  type: "door_result" | "door_opened" | "door_closed" | "lockdown";
  accepted: boolean;
  locked?: boolean;
  sealed?: boolean;
  code?: string;
  player?: string;
  door?: string;
  color?: string;
  room_code?: string;
  target_code?: string;
  message?: string;
  cost?: number;
  points?: number;
  sealed_strikes?: number;
};

export type HazardEvent = { id: number; player: string; room_code: string; penalty: number; points: number };
export type ReviveEvent = { id: number; player: string; by: string[]; points: Record<string, number> };
export type EliminationEvent = { id: number; player: string; reason: string };
export type GameOver = { won: boolean; reason: string; reason_code?: string; summary: any };

const EMPTY_NEXUS: NexusReport = {
  team_skill: 0, difficulty: 0, complexity_level: 0, players: [], last_action: null,
};
const FATAL_ERRORS = new Set([
  "auth_required", "auth_invalid", "auth_timeout", "auth_unavailable",
  "admin_required", "room_full", "game_started", "server_full",
  "invalid_username", "username_taken", "profile_unavailable",
  "app_check_invalid", "app_check_unavailable", "room_not_found", "room_expired",
  "join_timeout", "join_failed",
]);

function livePlayers(players: Player[] | undefined): Player[] {
  return (players ?? []).filter((p) => p.connected !== false);
}

function socketUrl(room: string, name: string, pid: string) {
  const origin = window.location.origin;
  let base: URL;
  try {
    const sameOrigin = process.env.AXIOM_SAME_ORIGIN_WS === "1";
    const configured = sameOrigin
      ? ""
      : process.env.NEXT_PUBLIC_WS_URL?.trim() || process.env.WS_URL?.trim();
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
  const [notice, setNotice] = useState<ToastText | null>(null);
  const [sealedAlert, setSealedAlert] = useState<SealedAlert | null>(null);
  const [you, setYou] = useState<string | null>(null);
  const [arena, setArena] = useState<Arena | null>(null);
  const [prevArena, setPrevArena] = useState<Arena | null>(null);
  const [wristband, setWristband] = useState<Wristband | null>(null);
  const [wristbandSanctions, setWristbandSanctions] = useState<string[]>([]);
  const [wristbandCooldownAt, setWristbandCooldownAt] = useState<number | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [status, setStatus] = useState<Status>("lobby");
  const [round, setRound] = useState(0);
  const [maxRounds, setMaxRounds] = useState(0);
  const [stage, setStage] = useState(1);
  const [stageName, setStageName] = useState("Induction");
  const [maxStage, setMaxStage] = useState(7);
  const [ruleCount, setRuleCount] = useState(1);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [roundSeconds, setRoundSeconds] = useState(20);
  const [matchAt, setMatchAt] = useState<number | null>(null);
  const [matchSeconds, setMatchSeconds] = useState(1800);
  const [minPlayers, setMinPlayers] = useState(1);
  const [nexus, setNexus] = useState<NexusReport>(EMPTY_NEXUS);
  const [pa, setPa] = useState("The Last Room is open. Find the hidden exit.");
  const [role, setRole] = useState<Role | null>(null);
  const [roleLabel, setRoleLabel] = useState("Assigning role");
  const [roleHint, setRoleHint] = useState("Waiting for the Dealer to assign your role.");
  const [me, setMe] = useState<You | null>(null);
  const [delayPuzzle, setDelayPuzzle] = useState<DelayPuzzleView | null>(null);
  const [delayKey, setDelayKey] = useState<DelayKeyView | null>(null);
  const [delayStatus, setDelayStatus] = useState<DelayStatusView | null>(null);
  const [delayResult, setDelayResult] = useState<DelayResultView | null>(null);
  const [delayDeadlineAt, setDelayDeadlineAt] = useState<number | null>(null);
  const [transition, setTransition] = useState<RoundTransition>({
    id: 0, round: 0, moved: [], sigils: [], patternType: null, patternTypes: null, previous: null,
  });
  const [prediction, setPrediction] = useState<{
    id: number; correct: boolean; score: number; points: number; message: string;
  } | null>(null);
  const [doorEvent, setDoorEvent] = useState<DoorEvent | null>(null);
  const [cross, setCross] = useState<CrossEvent>({
    id: 0, door: null, from: null, to: null, cost: 0, player: null,
  });
  const [hazard, setHazard] = useState<HazardEvent | null>(null);
  const [revive, setRevive] = useState<ReviveEvent | null>(null);
  const [eliminated, setEliminated] = useState<EliminationEvent | null>(null);
  const [poses, setPoses] = useState<Record<string, Pose>>({});
  const [playerLeft, setPlayerLeft] = useState<PlayerLeftEvent | null>(null);
  const [king, setKing] = useState<KingView | null>(null);
  const [kingWatch, setKingWatch] = useState<KingWatchView | null>(null);
  const [kingEvent, setKingEvent] = useState<KingEvent | null>(null);
  const [notes, setNotes] = useState<NoteLine[]>([]);
  const [exitNotice, setExitNotice] = useState<ToastText | null>(null);
  const [gameOver, setGameOver] = useState<GameOver | null>(null);
  const [dealerClue, setDealerClue] = useState<DealerClue | null>(null);
  const [dealerNudge, setDealerNudge] = useState<DealerNudge | null>(null);
  const [puzzle, setPuzzle] = useState<PuzzleSnapshot | null>(null);
  const [puzzleResult, setPuzzleResult] = useState<PuzzleResult | null>(null);
  const [sanctionTotal, setSanctionTotal] = useState(0);
  const [sanctionFound, setSanctionFound] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const youRef = useRef<string | null>(null);
  const exitingRef = useRef(false);
  const noticeSeq = useRef(0);
  const sealedSeq = useRef(0);
  const exitSeq = useRef(0);

  const pushNotice = useCallback((text: string) => {
    setNotice({ id: ++noticeSeq.current, text });
  }, []);
  const pushSealedAlert = useCallback((message: string, fields: Omit<SealedAlert, "id" | "message"> = {}) => {
    setSealedAlert({ id: ++sealedSeq.current, message, ...fields });
  }, []);
  const pushExitNotice = useCallback((text: string) => {
    setExitNotice({ id: ++exitSeq.current, text });
  }, []);

  useEffect(() => {
    if (!dealerClue) return;
    const timer = window.setTimeout(() => setDealerClue(null), 5000);
    return () => window.clearTimeout(timer);
  }, [dealerClue]);

  useEffect(() => {
    if (!dealerNudge) return;
    const timer = window.setTimeout(() => setDealerNudge(null), 5000);
    return () => window.clearTimeout(timer);
  }, [dealerNudge]);

  useEffect(() => {
    if (!puzzleResult) return;
    const timer = window.setTimeout(() => setPuzzleResult(null), 5000);
    return () => window.clearTimeout(timer);
  }, [puzzleResult]);

  useEffect(() => {
    if (!delayResult) return;
    const timer = window.setTimeout(() => setDelayResult(null), 5000);
    return () => window.clearTimeout(timer);
  }, [delayResult]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!sealedAlert) return;
    const timer = window.setTimeout(() => setSealedAlert(null), 2000);
    return () => window.clearTimeout(timer);
  }, [sealedAlert]);

  useEffect(() => {
    if (!doorEvent) return;
    const timer = window.setTimeout(() => setDoorEvent(null), 5000);
    return () => window.clearTimeout(timer);
  }, [doorEvent]);

  useEffect(() => {
    if (cross.id <= 0) return;
    const timer = window.setTimeout(() => setCross((prev) => ({
      id: prev.id, door: null, from: null, to: null, cost: 0, player: null,
    })), 5000);
    return () => window.clearTimeout(timer);
  }, [cross]);

  useEffect(() => {
    if (!hazard) return;
    const timer = window.setTimeout(() => setHazard(null), 5000);
    return () => window.clearTimeout(timer);
  }, [hazard]);

  useEffect(() => {
    if (!revive) return;
    const timer = window.setTimeout(() => setRevive(null), 5000);
    return () => window.clearTimeout(timer);
  }, [revive]);

  useEffect(() => {
    if (!exitNotice) return;
    const timer = window.setTimeout(() => setExitNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [exitNotice]);

  useEffect(() => {
    if (!playerLeft) return;
    const timer = window.setTimeout(() => setPlayerLeft(null), 5000);
    return () => window.clearTimeout(timer);
  }, [playerLeft]);

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
      setWristbandSanctions(s.wristband_sanctions ?? []);
      const cooldown = Number(s.you?.wristband_cooldown_remaining ?? 0);
      setWristbandCooldownAt(cooldown > 0 ? performance.now() + cooldown * 1000 : null);
      const visible = livePlayers(s.players);
      setPlayers(visible);
      const liveIds = new Set(visible.map((p) => p.id));
      setPoses((current) => Object.fromEntries(
        Object.entries(current).filter(([id]) => liveIds.has(id)),
      ));
      setMe(s.you);
      if (s.you?.id) youRef.current = s.you.id;
      setStatus(s.status);
      setRound(s.round ?? 0);
      setMaxRounds(s.max_rounds ?? 0);
      setStage(s.stage);
      setStageName(s.stage_name);
      setMaxStage(s.max_stage);
      setRuleCount(s.rule_count);
      setSanctionTotal(s.sanction_total ?? 0);
      setSanctionFound(s.sanction_found ?? 0);
      setMinPlayers(s.min_players);
      setRoundSeconds(s.round_seconds ?? 20);
      setMatchSeconds(s.match_seconds ?? 1800);
      setMatchAt(s.match_time_left != null ? performance.now() + s.match_time_left * 1000 : null);
      setNexus(s.nexus ?? EMPTY_NEXUS);
      setPa(s.pa ?? "");
      setNotes(s.notes ?? []);
      setRole(s.role);
      setRoleLabel(s.role_label);
      setRoleHint(s.role_hint);
      setDelayStatus(s.delay_status ?? null);
      setKing(s.king ?? null);
      setKingWatch(s.king_watch ?? null);
      setPuzzle(s.puzzle ?? null);
      setNextAt(s.next_round_in != null ? performance.now() + s.next_round_in * 1000 : null);
    };

    const scheduleReconnect = () => {
      if (disposed || fatalClose || exitingRef.current) return;
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
          restoredTimer = window.setTimeout(() => setRestored(false), 5000);
        }
        hadConnected = true;
        void (async () => {
          let idToken: string | null = null;
          let authReady = false;
          try {
            const auth = getFirebaseAuth();
            await auth.authStateReady();
            authReady = true;
            idToken = (await auth.currentUser?.getIdToken()) ?? null;
          } catch {
            idToken = null;
          }
          const appCheck = await appCheckToken();
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({
            type: "auth",
            token: idToken,
            app_check: appCheck,
            name,
            pid: storedId || undefined,
            pfp_preset_id: !idToken && authReady ? guest.getPfp() : undefined,
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
          if (m.game_over) {
            setGameOver({
              won: !!m.game_over.won,
              reason: String(m.game_over.reason ?? "The match ended."),
              reason_code: m.game_over.reason_code ? String(m.game_over.reason_code) : undefined,
              summary: m.game_over.summary,
            });
            setStatus(m.game_over.won ? "won" : "over");
          }
          apply(m.state);
        } else if (m.type === "state") {
          apply(m.state);
        } else if (m.type === "players") {
          setPlayers(livePlayers(m.players));
          setStatus(m.status);
          if (m.status !== "running") setNextAt(null);
        } else if (m.type === "round") {
          const tv = m as RoundView;
          if (tv.arena) setArena(tv.arena);
          if (tv.previous) setPrevArena(tv.previous);
          if (tv.players) setPlayers(livePlayers(tv.players));
          setTransition((t) => ({
            id: t.id + 1,
            round: tv.round,
            moved: (tv.moved ?? []).map((x) => ({
              from: x.from, to: x.to, code_from: x.code_from, code_to: x.code_to,
            })),
            sigils: tv.sigils ?? [],
            patternType: tv.pattern_type,
            patternTypes: tv.pattern_types ?? null,
            previous: tv.previous ?? null,
          }));
          setRound(tv.round);
          if (tv.pa) setPa(tv.pa);
          if (tv.next_round_in != null) setNextAt(performance.now() + tv.next_round_in * 1000);
          if (tv.state) apply(tv.state);
        } else if (m.type === "door_result") {
          const cost = Number(m.cost ?? 1) || 1;
          const code = m.code ? String(m.code) : undefined;
          const sealed = !!m.sealed || code === "sealed" || code === "sealed_lockdown";
          if (code === "sealed" && (!m.player || m.player === youRef.current)) {
            pushSealedAlert(String(m.message ?? "That door is sealed."), {
              door: m.door ? String(m.door) : undefined,
              room_code: m.room_code ? String(m.room_code) : undefined,
              points: m.points === undefined ? undefined : Number(m.points),
              sealed_strikes: m.sealed_strikes === undefined ? undefined : Number(m.sealed_strikes),
            });
          }
          setDoorEvent((prev) => ({
            id: (prev?.id ?? 0) + 1, type: "door_result",
            accepted: !!m.accepted, locked: !!m.locked, sealed, code,
            player: m.player ? String(m.player) : undefined,
            door: m.door, color: m.color,
            room_code: m.room_code, target_code: m.target_code,
            message: m.message, cost,
            points: m.points === undefined ? undefined : Number(m.points),
            sealed_strikes: m.sealed_strikes === undefined ? undefined : Number(m.sealed_strikes),
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
          if (m.player !== youRef.current) {
            pushNotice(String(m.message ?? "A sealed-door lockdown was triggered."));
          }
        } else if (m.type === "hazard") {
          setHazard((prev) => ({
            id: (prev?.id ?? 0) + 1, player: m.player,
            room_code: m.room_code, penalty: m.penalty, points: m.points,
          }));
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
        } else if (m.type === "puzzle") {
          setDelayPuzzle(m as DelayPuzzleView);
          setDelayKey(null);
          setDelayResult(null);
          setDelayDeadlineAt(performance.now() + Number(m.answer_ms || 0));
        } else if (m.type === "puzzle_key") {
          setDelayKey(m as DelayKeyView);
        } else if (m.type === "delay_status") {
          setDelayStatus(m as DelayStatusView);
        } else if (m.type === "delay_result") {
          setDelayResult(m as DelayResultView);
          setDelayPuzzle(null);
          setDelayKey(null);
          setDelayDeadlineAt(null);
          pushNotice(String(m.message ?? (m.ok ? "The Dealer bought time." : "The Dealer took time back.")));
        } else if (m.type === "revive") {
          setRevive((prev) => ({
            id: (prev?.id ?? 0) + 1, player: m.player, by: m.by, points: m.points,
          }));
        } else if (m.type === "elimination") {
          setEliminated((prev) => ({
            id: (prev?.id ?? 0) + 1, player: m.player, reason: m.reason,
          }));
        } else if (m.type === "player_move") {
          const event = m as PlayerMoveEvent;
          const pose: Pose = {
            x: Number(event.x) || 0,
            z: Number(event.z) || 0,
            yaw: Number(event.yaw) || 0,
            moving: !!event.moving,
          };
          setPoses((current) => ({ ...current, [event.player]: pose }));
          setPlayers((current) => current.map((p) =>
            p.id === event.player ? { ...p, pose } : p,
          ));
        } else if (m.type === "player_left") {
          if (Array.isArray(m.players)) setPlayers(livePlayers(m.players));
          else setPlayers((current) => current.filter((p) => p.id !== m.player));
          setPoses((current) => {
            const next = { ...current };
            delete next[String(m.player)];
            return next;
          });
          if (m.status) setStatus(m.status);
          setPlayerLeft((prev) => ({
            id: (prev?.id ?? 0) + 1,
            player: String(m.player ?? ""),
            name: String(m.name ?? "A player"),
            message: String(m.message ?? "A player left the arena."),
          }));
        } else if (m.type === "king_watch") {
          setKingWatch(m as KingWatchView);
        } else if (m.type === "king_spawn") {
          const view = m.king as KingView | null;
          setKing(view);
          setKingEvent((prev) => ({
            id: (prev?.id ?? 0) + 1, type: "spawn", king: view,
            room_code: view?.room_code ?? null,
          }));
        } else if (m.type === "king_teleport") {
          const view = m.king as KingView | null;
          setKing(view);
          setKingEvent((prev) => ({
            id: (prev?.id ?? 0) + 1, type: "teleport", king: view,
            room_code: view?.room_code ?? null,
          }));
        } else if (m.type === "king_despawn") {
          setKing(null);
          setKingEvent((prev) => ({
            id: (prev?.id ?? 0) + 1, type: "despawn",
            king: (m.king as KingView | null) ?? null,
            room_code: (m.king as KingView | null)?.room_code ?? null,
          }));
        } else if (m.type === "king_kill") {
          setKingEvent((prev) => ({
            id: (prev?.id ?? 0) + 1, type: "kill",
            room_code: m.room_code ?? null, room: m.room ?? null,
            victim: m.victim, victim_name: m.victim_name, reason: m.reason,
          }));
          if (m.victim === youRef.current) pushNotice("THE KING OF SPADES TOOK YOU.");
        } else if (m.type === "prediction_result") {
          setPrediction((prev) => ({
            id: (prev?.id ?? 0) + 1,
            correct: !!m.correct, score: Number(m.score) || 0,
            points: Number(m.points) || 0, message: String(m.message ?? ""),
          }));
        } else if (m.type === "notes") {
          setNotes((current) => [...current, {
            id: Number(m.id) || 0, from: m.from, color: m.color, text: m.text,
          }].slice(-40));
        } else if (m.type === "exit_found") {
          pushExitNotice(String(m.message ?? "EXIT SIGHTED. TELL YOUR TEAM."));
        } else if (m.type === "time_up") {
          setMatchAt(null);
          setPa(m.message ?? "TIME EXPIRED. THE TEAM WAS ELIMINATED.");
        } else if (m.type === "game_over") {
          setGameOver({
            won: !!m.won,
            reason: String(m.reason ?? "The match ended."),
            reason_code: m.reason_code ? String(m.reason_code) : undefined,
            summary: m.summary,
          });
          setStatus(m.won ? "won" : "over");
        } else if (m.type === "wristband_reveal") {
          pushNotice(String(m.message ?? "Wristband revealed until the next shift."));
        } else if (m.type === "error") {
          const message = m.message || m.code || "That action could not be completed.";
          if (FATAL_ERRORS.has(m.code)) {
            setError(message);
            fatalClose = true;
            ws.close();
          } else {
            pushNotice(message);
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
  }, [room, name, pushNotice, pushExitNotice, pushSealedAlert]);

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
  const sendPose = useCallback((pose: Pose) => send({ type: "pose", ...pose }), [send]);
  const sendNotes = useCallback((text: string) => send({ type: "notes", text }), [send]);
  const sendPuzzleMark = useCallback(
    (role: Role, value: string) => send({ type: "puzzle_submit", assignment: { [role]: value } }),
    [send],
  );
  const sendRevealWristband = useCallback(
    () => send({ type: "pathfinder_reveal" }),
    [send],
  );
  const sendDelayQueue = useCallback(
    (tier: 1 | 2 | 3) => send({ type: "delay_queue", tier }),
    [send],
  );
  const sendDelayAnswer = useCallback(
    (puzzleId: string, answer: { row: number; col: number } | Sigil) =>
      send({ type: "delay_answer", puzzle_id: puzzleId, answer }),
    [send],
  );
  const exitMatch = useCallback(() => {
    exitingRef.current = true;
    try {
      sessionStorage.removeItem(`axiom_pid_${room}`);
    } catch {}
    const ws = wsRef.current;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
    wsRef.current = null;
    setConnected(false);
  }, [room]);

  return {
    connected, attempts, restored, error, notice, sealedAlert, you, me, arena, prevArena, wristband, wristbandSanctions, wristbandCooldownAt, players, status, round, maxRounds, stage,
    stageName, maxStage, ruleCount, nextAt, roundSeconds, matchAt, matchSeconds, minPlayers, nexus, pa, role, roleLabel,
    roleHint, transition, prediction, doorEvent, cross,
    hazard, revive, eliminated, poses, playerLeft, king, kingWatch, kingEvent, notes, exitNotice, gameOver,
    dealerClue, dealerNudge, puzzle, puzzleResult, sanctionTotal, sanctionFound,
    delayPuzzle, delayKey, delayStatus, delayResult, delayDeadlineAt,
    sendOpenDoor, sendCrossDoor, sendWait, sendUnlock, sendPredict, sendReady, sendPose, sendNotes,
    sendPuzzleMark, sendRevealWristband, sendDelayQueue, sendDelayAnswer, exitMatch,
  };
}
