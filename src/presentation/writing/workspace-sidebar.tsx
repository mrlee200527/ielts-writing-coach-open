export function WorkspaceSidebar({ saveStatus }: { saveStatus: string }) {
  return <aside className="panel sidebar"><p className="eyebrow">写作状态</p><div className="status-card"><strong>AI 反馈将在后续阶段启用</strong><p>当前阶段专注于稳定写作、自动保存与正文恢复。</p></div><div data-testid="save-status" className="save-badge">{saveStatus}</div></aside>;
}
