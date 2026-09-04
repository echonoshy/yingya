import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { agentEventSchema } from "../schemas";
import type { AgentEvent } from "../types";

const MAX_TIMELINE_EVENTS = 2_000;
const DISCONNECTED_AFTER_MS = 10_000;
const STALLED_AFTER_MS = 5 * 60_000;

export type AgentConnectionState = "connecting" | "connected" | "recovering" | "disconnected";

export function mergeEvents(current: AgentEvent[], incoming: AgentEvent[]) {
  const bySeq = new Map(current.map(event => [event.seq, event]));
  for (const event of incoming) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-MAX_TIMELINE_EVENTS);
}

export function isAgentRunStalled(running: boolean, lastProgressAt: number, now = Date.now()) {
  return running && now - lastProgressAt >= STALLED_AFTER_MS;
}

export function isAgentProgressEvent(event: AgentEvent) {
  return event.method !== "error" && event.method !== "warning";
}

export function latestAgentProgressAt(events: AgentEvent[], fallback: number) {
  return [...events].reverse().find(isAgentProgressEvent)?.createdAt ?? fallback;
}

export function useAgentEvents(projectId: string, onProjectChanged: () => void | Promise<void>, running = false) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<number>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [connectionState, setConnectionState] = useState<AgentConnectionState>("connecting");
  const [stalled, setStalled] = useState(false);
  const callbackRef = useRef(onProjectChanged);
  const lastProgressAtRef = useRef(Date.now());
  callbackRef.current = onProjectChanged;

  const loadRecent = useCallback(async () => {
    const page = await api.eventLog(projectId, undefined, 500);
    setEvents(page.items);
    setNextBefore(page.nextBefore);
    lastProgressAtRef.current = latestAgentProgressAt(page.items, lastProgressAtRef.current);
    setStalled(isAgentRunStalled(running, lastProgressAtRef.current));
    return page.latestSeq;
  }, [projectId, running]);

  const resync = useCallback(async () => {
    setConnectionState("recovering");
    try {
      await loadRecent();
      await callbackRef.current();
      setConnectionState("connected");
    } catch {
      setConnectionState("disconnected");
    }
  }, [loadRecent]);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | undefined;
    let retryTimer: number | undefined;
    let disconnectTimer: number | undefined;
    setEvents([]);
    setNextBefore(undefined);
    setConnectionState("connecting");
    lastProgressAtRef.current = Date.now();
    setStalled(false);

    const connect = async (): Promise<void> => {
      try {
        const cursor = await loadRecent();
        if (disposed) return;
        setConnectionState("connected");
        source = new EventSource(`/api/agent-projects/${projectId}/events?after=${cursor}`);
        source.onopen = () => {
          if (disconnectTimer) window.clearTimeout(disconnectTimer);
          setConnectionState("connected");
        };
        source.onerror = () => {
          if (disposed) return;
          setConnectionState("recovering");
          void callbackRef.current();
          if (disconnectTimer) window.clearTimeout(disconnectTimer);
          disconnectTimer = window.setTimeout(() => setConnectionState("disconnected"), DISCONNECTED_AFTER_MS);
        };
        source.addEventListener("agent-event", raw => {
          let payload: unknown;
          try { payload = JSON.parse((raw as MessageEvent).data); }
          catch { return; }
          const parsed = agentEventSchema.safeParse(payload);
          if (!parsed.success) return;
          if (isAgentProgressEvent(parsed.data)) {
            lastProgressAtRef.current = parsed.data.createdAt;
            setStalled(false);
          }
          setEvents(current => mergeEvents(current, [parsed.data]));
          if (/^(project|queue|media|render)\//.test(parsed.data.method) || parsed.data.method === "turn/completed" || parsed.data.method === "turn/failed") callbackRef.current();
        });
        source.addEventListener("resync-required", () => { void resync(); });
      } catch {
        if (disposed) return;
        setConnectionState("disconnected");
        retryTimer = window.setTimeout(() => {
          setConnectionState("recovering");
          void connect();
        }, 2_000);
      }
    };
    void connect();
    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      if (disconnectTimer) window.clearTimeout(disconnectTimer);
      source?.close();
    };
  }, [loadRecent, projectId, resync]);

  useEffect(() => {
    if (!running) {
      lastProgressAtRef.current = Date.now();
      setStalled(false);
      return;
    }
    const timer = window.setInterval(() => {
      setStalled(isAgentRunStalled(true, lastProgressAtRef.current));
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [running]);

  const loadOlder = useCallback(async () => {
    if (!nextBefore || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await api.eventLog(projectId, nextBefore, 200);
      setEvents(current => mergeEvents(page.items, current));
      setNextBefore(page.nextBefore);
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, nextBefore, projectId]);

  return { events, hasOlder: nextBefore !== undefined, loadOlder, loadingOlder, connectionState, stalled, resync };
}
