export function WorkspaceHeader() {
  return <header className="topbar">
    <div className="brand-lockup"><span className="brand-mark">✦</span><strong>AI IELTS Writing Coach</strong><span className="phase-pill">Beta</span></div>
    <nav className="mode-switcher" aria-label="写作模式">
      <button type="button" className="mode-button active" aria-pressed="true">实时助手模式</button>
      <button type="button" className="mode-button" disabled>段落分析模式 <small>即将推出</small></button>
      <button type="button" className="mode-button" disabled>模拟考试模式 <small>即将推出</small></button>
    </nav>
    <div className="local-profile" aria-label="本地个人模式"><span>本地模式</span><span className="profile-avatar">S</span></div>
  </header>;
}

const journeySteps = [
  { icon: "✎", title: "输入内容", detail: "在编辑区完成 Task 1", state: "可用" },
  { icon: "✓", title: "自动保存", detail: "持续保存并支持恢复", state: "可用" },
  { icon: "◇", title: "题图理解", detail: "使用真实 Task Context", state: "可用" },
  { icon: "AI", title: "全文反馈", detail: "请求 MiMo 完整分析", state: "按需" },
  { icon: "◎", title: "学习与记忆", detail: "跨练习追踪进步", state: "即将推出" },
];

export function WritingJourney({ taskType }: { taskType: "TASK_1" | "TASK_2" }) {
  const steps = taskType === "TASK_1" ? journeySteps : journeySteps.filter((step) => step.title !== "题图理解").map((step) => step.title === "输入内容" ? { ...step, detail: "在编辑区完成写作" } : step);
  return <section className="panel journey-section">
    <p className="eyebrow">AI 如何陪伴你写作</p>
    <div className="journey-track">
      {steps.map((step, index) => <div className={`journey-step ${step.state === "即将推出" ? "upcoming" : ""}`} key={step.title}>
        <span className="journey-icon">{step.icon}</span>
        <div><strong>{step.title}</strong><p>{step.detail}</p><small>{step.state}</small></div>
        {index < steps.length - 1 ? <span className="journey-arrow" aria-hidden="true">→</span> : null}
      </div>)}
    </div>
  </section>;
}

export function LearningMemory() {
  return <section className="panel memory-section">
    <div><p className="eyebrow">我的学习记忆</p><h2>让每一次练习积累成长期进步</h2></div>
    <div className="memory-empty">
      <span className="memory-icon">◎</span>
      <div><strong>学习记忆将在持续练习后显示在这里。</strong><p>v0.1 不会虚构高频错误、已掌握表达或个人偏好。</p></div>
      <span className="coming-soon">即将推出</span>
    </div>
  </section>;
}
