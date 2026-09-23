"use client";
import { useState } from "react";
const targetBands = ["6.0", "6.5", "7.0", "7.5"] as const;
type TargetBand = (typeof targetBands)[number];
const targetBandKey = (sessionId: string) => `target-band:${sessionId}`;
const MAX_TASK_TEXT_BYTES = 256 * 1024;
async function readTaskTextFile(file: File) {
  const hasTxtName = file.name.toLowerCase().endsWith(".txt");
  if (!hasTxtName || (file.type && file.type !== "text/plain")) throw new Error("INVALID_TEXT_TYPE");
  if (file.size > MAX_TASK_TEXT_BYTES) throw new Error("TEXT_TOO_LARGE");
  const text = await file.text();
  if (!text.trim()) throw new Error("EMPTY_TEXT");
  return text;
}
const taskTextErrorMessage: Record<string, string> = {
  INVALID_TEXT_TYPE: "仅支持 TXT 纯文本文件。",
  TEXT_TOO_LARGE: "TXT 文件超过 256 KB，请缩小后重试。",
  EMPTY_TEXT: "TXT 文件没有可用文字，请重新选择。",
  TEXT_READ_FAILED: "无法读取 TXT 文件，请重新选择或直接粘贴文字。",
};
const uploadErrorMessage = (code?: string) => {
  if (code === "IMAGE_SIGNATURE_MISMATCH") return "文件扩展名与实际图片格式不一致，请重命名为正确的 JPG/JPEG、PNG 或 WEBP 后重试。";
  if (code === "UNSUPPORTED_IMAGE_TYPE") return "暂不支持这种图片格式，请使用 JPG/JPEG、PNG 或 WEBP。";
  if (code === "IMAGE_TOO_LARGE") return "图片超过 10 MB，请压缩后重试。";
  if (code === "EMPTY_IMAGE") return "图片文件为空，请重新选择。";
  return "Session creation failed. Please retry.";
};
export function TaskIntakeForm({ navigate = (path: string) => { window.location.href = path; } }: { navigate?: (path: string) => void }) {
  const [taskType, setTaskType] = useState<"TASK_1" | "TASK_2">("TASK_1"); const [file, setFile] = useState<File>(); const [prompt, setPrompt] = useState(""); const [textFileName, setTextFileName] = useState(""); const [targetBand, setTargetBand] = useState<TargetBand>("6.5"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function importTaskText(selectedFile?: File) { if (!selectedFile) return; try { const text = await readTaskTextFile(selectedFile); setPrompt(text); setTextFileName(selectedFile.name); setError(""); } catch (cause) { const code = cause instanceof Error ? cause.message : "TEXT_READ_FAILED"; setError(taskTextErrorMessage[code] ?? taskTextErrorMessage.TEXT_READ_FAILED); } }
  async function submit() { if (taskType === "TASK_1" && !file) { setError("请选择 Task 1 题图。"); return; } if (!prompt.trim()) { setError(taskType === "TASK_1" ? "请输入题目文字或上传 TXT 文件。" : "Enter the Task 2 question."); return; } setBusy(true); setError(""); try { let response: Response; if (taskType === "TASK_1") { const form = new FormData(); form.append("image", file!); form.append("promptText", prompt); if (textFileName) form.append("txtFileName", textFileName); form.append("clientRequestId", crypto.randomUUID()); response = await fetch("/api/task-intakes", { method: "POST", body: form }); } else { response = await fetch("/api/essays", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientRequestId: crypto.randomUUID(), promptText: prompt.trim(), taskType, ...(textFileName ? { txtFileName: textFileName } : {}) }) }); } const body = await response.json() as { sessionId?: string; error?: string }; if (!response.ok || !body.sessionId) { setError(uploadErrorMessage(body.error)); setBusy(false); return; } localStorage.setItem(targetBandKey(body.sessionId), targetBand); navigate(`/write/${body.sessionId}`); } catch { setError("Session creation failed. Please retry."); setBusy(false); } }
  return <section className="task-intake-form">
    <div className="task-type-switch" role="group" aria-label="Task type"><button type="button" className={taskType === "TASK_1" ? "active" : ""} onClick={() => { setTaskType("TASK_1"); setError(""); }}>Task 1</button><button type="button" className={taskType === "TASK_2" ? "active" : ""} onClick={() => { setTaskType("TASK_2"); setError(""); }}>Task 2</button></div>
    <div className="task-type-switch target-band-switch" role="group" aria-label="Target Band">
      {targetBands.map((band) => <button type="button" key={band} className={targetBand === band ? "active" : ""} onClick={() => { setTargetBand(band); setError(""); }}>Target {band}</button>)}
    </div>
    <p className="field-label target-band-label">目标分数：实时辅导按此档位选择值得提示的问题，语言错误一律照常检查。</p>
    {taskType === "TASK_1" ? <div className="form-field">
      <span className="field-label">Task image</span>
      <label className={`upload-zone${file ? " has-file" : ""}`} htmlFor="task-image-input">
        <input id="task-image-input" className="visually-hidden" aria-label="Task image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0])} />
        <span className="upload-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>
        </span>
        <span className="upload-title">{file ? "Image selected" : "Choose Task 1 image"}</span>
        <span className="upload-help">支持 JPG/JPEG、PNG、WEBP · 最大 10 MB</span>
        {file && <span className="selected-file">{file.name}</span>}
      </label>
    </div> : null}
    <div className="form-field">
      <span className="field-label">Task text file <span className="optional-label">(optional alternative)</span></span>
      <label className={`upload-zone text-upload-zone${textFileName ? " has-file" : ""}`} htmlFor="task-text-file-input">
      <input id="task-text-file-input" className="visually-hidden" aria-label="Task text file" type="file" accept=".txt,text/plain" onChange={(event) => void importTaskText(event.target.files?.[0])} />
      <span className="upload-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>
      </span>
      <span className="upload-title">{textFileName ? "TXT 文件已选择" : "选择 TXT 题目文件"}</span>
      <span className="upload-help">支持 TXT（可含 Markdown）· 最大 256 KB</span>
      {textFileName ? <span className="selected-file">{textFileName}</span> : null}
      </label>
    </div>
    <label className="form-field" htmlFor="task-text-input">
      <span className="field-label">Task text <span className="optional-label">(required)</span></span>
      <textarea id="task-text-input" aria-label="Task text" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Paste the task instructions here if needed..." />
    </label>
    <div className="form-actions">
      {error && <p className="form-error" role="alert">{error}</p>}
      <button disabled={busy} onClick={submit}>{busy ? "Starting..." : "Start writing"}</button>
    </div>
  </section>;
}
