"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { api, type MeResponse, type Profile } from "@/lib/api";

type ProfileStatus = "idle" | "loading" | "ready" | "refreshing" | "error";

type ProfileContextValue = {
  data: MeResponse | null;
  status: ProfileStatus;
  error: string | null;
  refresh: (force?: boolean) => Promise<MeResponse | null>;
  patchProfile: (profile: Profile) => void;
};

const ProfileContext = createContext<ProfileContextValue>({
  data: null,
  status: "idle",
  error: null,
  refresh: async () => null,
  patchProfile: () => undefined,
});

const CACHE_TTL_MS = 30_000;

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [data, setData] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<ProfileStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const uidRef = useRef<string | null>(null);
  const userRef = useRef(user);
  userRef.current = user;
  const loadedAtRef = useRef(0);
  const runIdRef = useRef(0);
  const inFlightRef = useRef<{ id: number; promise: Promise<MeResponse | null> } | null>(null);

  const reset = useCallback(() => {
    uidRef.current = null;
    loadedAtRef.current = 0;
    inFlightRef.current = null;
    setData(null);
    setStatus("idle");
    setError(null);
  }, []);

  const refresh = useCallback(async (force = false) => {
    if (!user) return null;
    const uid = user.uid;
    if (!force && uidRef.current === uid && data && Date.now() - loadedAtRef.current < CACHE_TTL_MS) {
      return data;
    }
    if (inFlightRef.current) return inFlightRef.current.promise;

    const runId = ++runIdRef.current;
    const task = (async () => {
      setStatus(uidRef.current === uid && data ? "refreshing" : "loading");
      setError(null);
      try {
        const result = await api.me();
        if (userRef.current?.uid !== uid) return null;
        uidRef.current = uid;
        loadedAtRef.current = Date.now();
        setData(result);
        setStatus("ready");
        return result;
      } catch (cause) {
        if (userRef.current?.uid === uid) {
          setError(cause instanceof Error ? cause.message : "Profile storage is not available.");
          setStatus("error");
        }
        return null;
      } finally {
        if (inFlightRef.current?.id === runId) inFlightRef.current = null;
      }
    })();
    inFlightRef.current = { id: runId, promise: task };
    return task;
  }, [data, user]);

  const patchProfile = useCallback((profile: Profile) => {
    setData((current) => current ? { ...current, profile } : current);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      reset();
      return;
    }
    if (uidRef.current !== user.uid) reset();
    void refresh();
  }, [user, loading, reset, refresh]);

  return (
    <ProfileContext.Provider value={{ data, status, error, refresh, patchProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  return useContext(ProfileContext);
}
