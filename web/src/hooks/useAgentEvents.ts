import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { agentEventSchema } from "../schemas";
import type { AgentEvent } from "../types";

const MAX_TIMELINE_EVENTS = 2_000;

export function mergeEvents(current: AgentEvent[], incoming: AgentEvent[]) {
  const bySeq = new Map(current.map(event => [event.seq, event]));
  for (const event of incoming) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-MAX_TIMELINE_EVENTS);
}

export function useAgentEvents(projectId: string, onProjectChanged: () => void) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<number>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const callbackRef = useRef(onProjectChanged);
  callbackRef.current = onProjectChanged;

  const loadRecent = useCallback(async () => {
    const page = await api.eventLog(projectId, undefined, 500);
    setEvents(page.items);
    setNextBefore(page.nextBefore);
    return page.latestSeq;
  }, [projectId]);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | undefined;
    setEvents([]);
    setNextBefore(undefined);
    void loadRecent().then(cursor => {
      if (disposed) return;
      source = new EventSource(`/api/agent-projects/${projectId}/events?after=${cursor}`);
      source.addEventListener("agent-event", raw => {
        let payload: unknown;
        try { payload = JSON.parse((raw as MessageEvent).data); }
        catch { return; }
        const parsed = agentEventSchema.safeParse(payload);
        if (!parsed.success) return;
        setEvents(current => mergeEvents(current, [parsed.data]));
        if (/^(project|queue|media|render)\//.test(parsed.data.method) || parsed.data.method === "turn/completed" || parsed.data.method === "turn/failed") callbackRef.current();
      });
      source.addEventListener("resync-required", () => { void loadRecent().then(() => callbackRef.current()); });
    }).catch(() => undefined);
    return () => { disposed = true; source?.close(); };
  }, [loadRecent, projectId]);

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

  return { events, hasOlder: nextBefore !== undefined, loadOlder, loadingOlder };
}
