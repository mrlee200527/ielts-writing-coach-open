"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function StartWritingButton() {
  const router = useRouter(); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const start = async () => { setBusy(true); setError(""); try { const response = await fetch("/api/essays", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientRequestId: crypto.randomUUID(), promptText: "Summarise the information by selecting and reporting the main features, and make comparisons where relevant." }) }); if (!response.ok) throw new Error(); const result = await response.json(); router.push(`/write/${result.sessionId}`); } catch { setError("暂时无法开始，请重试"); setBusy(false); } };
  return <div><button data-testid="start-task-1" onClick={start} disabled={busy}>{busy ? "正在创建…" : "开始 Task 1 写作"}</button>{error && <p role="alert">{error}</p>}</div>;
}
