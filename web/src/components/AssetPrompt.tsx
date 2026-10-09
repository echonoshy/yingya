import { useState } from "react";
import { Copy, Check } from "@phosphor-icons/react";
export function AssetPrompt({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false), [error, setError] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setError(""); }
    catch { setError("复制未成功，请展开提示词后手动选择复制。"); }
  }
  return <section className="asset-prompt"><details><summary>生成提示词</summary><p>{prompt}</p></details><button aria-label="复制生成提示词" onClick={() => void copy()}>{copied ? <Check/> : <Copy/>}{copied ? "已复制" : "复制"}</button>{error ? <p role="alert">{error}</p> : null}</section>;
}
