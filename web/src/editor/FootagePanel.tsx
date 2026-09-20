import { createClientRequestId } from "../requestId";
import { useEffect, useRef, useState } from "react";
import { CircleNotch, Plus, VideoCamera } from "@phosphor-icons/react";
import { z } from "zod";
import { sessionFetch, sessionHeaders, scopedUrl } from "../session";
import { api } from "../api";
import type { AgentMedia } from "../types";
const capabilitySchema = z.object({
  available: z.boolean(),
  model: z.string(),
  reason: z.string(),
});
const jobSchema = z.object({
  id: z.string(),
  status: z.string(),
  progress: z.number(),
  error: z.string().nullable(),
  assetPath: z.string().nullable(),
  estimatedCredits: z.number().nullable().optional(),
  input: z.object({
    prompt: z.string(),
    duration: z.number(),
    aspectRatio: z.string(),
  }),
});
type Job = z.infer<typeof jobSchema>;
async function request(path: string, data?: unknown) {
  const r = await sessionFetch(scopedUrl(path), {
    method: data === undefined ? "GET" : "POST",
    headers: { ...sessionHeaders(), "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const value = await r.json();
  if (!r.ok) throw Error(value.message ?? value.error ?? "视频服务暂不可用");
  return value;
}
export async function videoCapabilities() {
  return capabilitySchema.parse(await request("/api/video/capabilities"));
}
const labels: Record<string, string> = {
  submitting: "正在提交",
  unknown: "提交结果待核对",
  PENDING: "等待生成",
  THROTTLED: "等待服务额度",
  RUNNING: "正在生成",
  SUCCEEDED: "生成完成",
  FAILED: "生成失败",
  CANCELLED: "已取消",
};
export function FootagePanel({
  projectId,
  assets,
  canInsert,
  onInsert,
}: {
  projectId: string;
  assets: AgentMedia["assets"];
  canInsert: boolean;
  onInsert: (asset: AgentMedia["assets"][number]) => Promise<void>;
}) {
  const [capability, setCapability] = useState<z.infer<
      typeof capabilitySchema
    > | null>(null),
    [prompt, setPrompt] = useState(""),
    [duration, setDuration] = useState(5),
    [ratio, setRatio] = useState("16:9"),
    [imagePath, setImagePath] = useState(""),
    [jobs, setJobs] = useState<Job[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef<{ signature: string; requestId: string } | null>(null),
    inFlight = useRef(false);
  useEffect(() => {
    let live = true,
      running = false;
    void videoCapabilities()
      .then((value) => {
        if (live) setCapability(value);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    const refresh = async () => {
      if (running) return;
      running = true;
      try {
        const response = await request(
          `/api/agent-projects/${projectId}/footage`,
        );
        if (live) setJobs(z.array(jobSchema).parse(response.jobs));
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "任务读取失败");
      } finally {
        running = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 7000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [projectId]);
  async function create() {
    if (inFlight.current || !capability?.available || !prompt.trim()) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const signature = JSON.stringify({ prompt, duration, ratio, imagePath });
    if (pending.current?.signature !== signature)
      pending.current = { signature, requestId: createClientRequestId() };
    try {
      const job = jobSchema.parse(
        await request(`/api/agent-projects/${projectId}/footage`, {
          requestId: pending.current.requestId,
          prompt,
          duration,
          aspectRatio: ratio,
          ...(imagePath ? { imagePath } : {}),
        }),
      );
      setJobs((current) => [
        job,
        ...current.filter((item) => item.id !== job.id),
      ]);
      if (job.status !== "unknown") {
        pending.current = null;
        setPrompt("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成未完成");
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  async function insert(job: Job) {
    try {
      const media = await api.getProjectMedia(projectId),
        asset = media.assets.find((a) => a.hyperframesPath === job.assetPath);
      if (!asset) throw Error("视频还在导入素材库，请稍后重试");
      await onInsert(asset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法插入片段");
    }
  }
  return (
    <>
      <p className="editor-hint">
        {capability?.reason ?? "正在读取视频服务状态…"}
      </p>
      <label className="editor-field">
        镜头描述
        <textarea
          rows={5}
          maxLength={1000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例如：晨光照进工作室，镜头缓慢推进桌上的产品…"
        />
      </label>
      <label className="editor-field">
        参考图片
        <select
          value={imagePath}
          onChange={(e) => setImagePath(e.target.value)}
        >
          <option value="">仅用文字生成</option>
          {assets
            .filter((a) => a.mediaType?.startsWith("image/"))
            .map((asset) => (
              <option key={asset.id} value={asset.hyperframesPath}>
                {asset.name}
              </option>
            ))}
        </select>
      </label>
      <div className="editor-field-grid">
        <label className="editor-field">
          片段时长
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option value={n} key={n}>
                {n} 秒
              </option>
            ))}
          </select>
        </label>
        <label className="editor-field">
          画幅
          <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
            <option value="16:9">16:9 横屏</option>
            <option value="9:16">9:16 竖屏</option>
          </select>
        </label>
      </div>
      <button
        className="primary-button"
        disabled={!capability?.available || !prompt.trim() || busy}
        onClick={() => void create()}
      >
        {busy ? <CircleNotch className="spin" /> : <VideoCamera />}
        {busy ? "正在提交…" : "生成视频片段"}
      </button>
      {capability?.available ? (
        <p className="editor-hint">
          使用 {capability.model}
          ，生成会使用已连接服务的额度。结果自动保存在项目素材中。
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="editor-footage-jobs">
        {jobs.map((job) => (
          <article key={job.id}>
            <header>
              <b>{labels[job.status] ?? job.status}</b>
              {job.status === "RUNNING" ? (
                <span>{Math.round(job.progress * 100)}%</span>
              ) : null}
            </header>
            <p>{job.input.prompt}</p>
            <small>
              {job.input.duration} 秒 · {job.input.aspectRatio}
              {job.estimatedCredits != null
                ? ` · 预计 ${job.estimatedCredits} 服务积分`
                : ""}
            </small>
            {job.error ? <p className="form-error">{job.error}</p> : null}
            {job.assetPath ? (
              <>
                <video
                  controls
                  preload="metadata"
                  src={api.fileUrl(projectId, job.assetPath)}
                />
                <button disabled={!canInsert} onClick={() => void insert(job)}>
                  <Plus />
                  {canInsert ? "插入当前镜头" : "先添加一个镜头"}
                </button>
              </>
            ) : ["PENDING", "RUNNING", "THROTTLED"].includes(job.status) ? (
              <button
                onClick={() =>
                  void request(
                    `/api/agent-projects/${projectId}/footage/${job.id}/cancel`,
                    {},
                  )
                    .then(() =>
                      setJobs((current) =>
                        current.map((item) =>
                          item.id === job.id
                            ? { ...item, status: "CANCELLED" }
                            : item,
                        ),
                      ),
                    )
                    .catch((e) => setError(e.message))
                }
              >
                取消生成
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </>
  );
}
