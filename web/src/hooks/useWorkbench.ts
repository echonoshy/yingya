import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Workbench } from "../types";

export function useWorkbench(projectId: string, versionId: string | undefined, updatedAt: number) {
  const [reload, setReload] = useState(0);
  const key = `${projectId}:${versionId ?? ""}`;
  const [result, setResult] = useState<{ key: string; data?: Workbench; error?: string }>({ key: "" });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api.getWorkbench(projectId, versionId).then(data => { if (!cancelled) setResult({ key, data }); })
      .catch(error => { if (!cancelled) setResult({ key, error: error instanceof Error ? error.message : "素材信息读取失败" }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, versionId, key, updatedAt, reload]);
  const refresh = useCallback(() => { setResult({ key: "" }); setLoading(true); setReload(value => value + 1); }, []);
  return { data: result.key === key ? result.data : undefined, error: result.key === key ? result.error : undefined, loading: loading || result.key !== key, refresh };
}
