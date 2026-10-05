"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertCircle, ArrowRight, ArrowUpRight, BookOpen, BrainCircuit,
  Check, CheckCircle2, ChevronDown, ChevronRight, Circle, Copy,
  Database, Download, ExternalLink, FileText, HardDriveDownload, Info,
  Layers3, Loader2, Menu, Pause, Play, Plus, RefreshCw, RotateCcw,
  Search, Settings2, ShieldCheck, Sparkles, Square, Trash2, Upload,
  Wrench, X, XCircle, Zap,
} from "lucide-react";
import {
  advanceRun, approveRun, createRun, deleteMemory, pauseRun, rejectRun,
  restoreRun, resumeRun, retryRun, stopRun, TOOL_REGISTRY, updateMemory,
  type AdvanceOptions, type Evidence, type MemoryRecord, type Run,
  type RunStatus, type StepStatus,
} from "@/lib/harness";

type View = "workbench" | "memory" | "tools";
type InspectorTab = "evidence" | "trace" | "checkpoint";
type Scenario = "normal" | "missing" | "stale" | "conflict" | "failure";
type Capabilities = {
  fuyao: { configured: boolean; status: string; tools: string[]; limits: Record<string, number> };
  ifind: { configured: boolean; status: string };
};
type LiveCheck = { state: "idle" | "loading" | "ready" | "unavailable" | "error"; message: string; requestId?: string; timestamp?: string };

const STORAGE_KEY = "investment-x-buddy-runs-v1";
const DEFAULT_GOAL = "研究贵州茅台 600519.SH：近期行情、估值水平和财务质量有哪些值得核查的变化？";
const INITIAL_RUN = createRun(DEFAULT_GOAL, { id: "welcome-demo" });

const statusText: Record<RunStatus, string> = {
  planned: "计划已就绪", running: "运行中", waiting_approval: "等待确认",
  paused: "已暂停", completed: "已完成", failed: "执行失败", stopped: "已停止",
};
const stepText: Record<StepStatus, string> = {
  pending: "待执行", running: "执行中", waiting_approval: "待确认",
  completed: "已完成", failed: "失败", skipped: "已跳过",
};
const scenarioText: Record<Scenario, string> = {
  normal: "正常链路", missing: "数据缺失", stale: "数据过期", conflict: "来源冲突", failure: "工具失败",
};

function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai", hour12: false });
}
function clock(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Shanghai", hour12: false });
}
function formatCost(value: number) { return `$${value.toFixed(4)}`; }
function shortId(value: string) { return value.length > 21 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value; }

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportMarkdown(run: Run): string {
  if (!run.report) return "";
  const report = run.report;
  const list = (items: { text: string; evidenceIds: string[] }[]) => items.map((item) =>
    `- ${item.text}${item.evidenceIds.length ? ` [证据：${item.evidenceIds.join("、")}]` : ""}`,
  ).join("\n") || "- 无";
  const evidence = run.evidence.map((item) =>
    `- **${item.id} · ${item.label}**：${item.displayValue}\n  - 来源：${item.source}；标的：${item.symbol}；时点：${item.asOf}；单位：${item.unit}\n  - 原始字段：\`${item.rawField}\` = \`${item.rawValue}\`；口径：${item.methodology}\n  - 质量：${item.quality}；请求 ID：${item.requestId}`,
  ).join("\n") || "- 无";
  return `# ${report.title}\n\n> 本地合成数据演示 · 非实时金融信息 · 非投资建议\n\n研究目标：${run.goal}\n生成时间：${report.generatedAt}\n运行 ID：${run.id}\n\n${report.summary}\n\n## 事实\n\n${list(report.facts)}\n\n## 推断\n\n${list(report.inferences)}\n\n## 待核验与缺口\n\n${list(report.unknowns)}\n\n## 证据索引\n\n${evidence}\n`;
}

function stepIcon(status: StepStatus) {
  if (status === "completed") return <Check size={15} strokeWidth={2.5} />;
  if (status === "running") return <Loader2 size={15} className="spin" />;
  if (status === "failed") return <X size={15} strokeWidth={2.5} />;
  if (status === "waiting_approval") return <ShieldCheck size={15} />;
  if (status === "skipped") return <X size={15} />;
  return <Circle size={11} strokeWidth={2.2} />;
}

export default function Home() {
  const [runs, setRuns] = useState<Run[]>([INITIAL_RUN]);
  const [activeId, setActiveId] = useState(INITIAL_RUN.id);
  const [hydrated, setHydrated] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState(false);
  const [view, setView] = useState<View>("workbench");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("evidence");
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [goalDraft, setGoalDraft] = useState(DEFAULT_GOAL);
  const [autoRun, setAutoRun] = useState(false);
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memoryKind, setMemoryKind] = useState<"preference" | "research_note">("research_note");
  const [memoryBank, setMemoryBank] = useState<MemoryRecord[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [liveCheck, setLiveCheck] = useState<LiveCheck>({ state: "idle", message: "尚未发起接口自检" });
  const [notice, setNotice] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const run = useMemo(() => runs.find((item) => item.id === activeId) || runs[0], [runs, activeId]);
  const evidence = useMemo(() => run.evidence.find((item) => item.id === selectedEvidenceId) || run.evidence[0] || null, [run.evidence, selectedEvidenceId]);
  const completeCount = run.steps.filter((item) => item.status === "completed").length;
  const progress = Math.round((completeCount / run.steps.length) * 100);
  const isAutoRunning = autoRun && (run.status === "planned" || run.status === "running");

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as { runs?: Run[]; activeId?: string; memory?: MemoryRecord[] };
          if (Array.isArray(parsed.runs) && parsed.runs.length) {
            let paused = false;
            const restored = parsed.runs.map((item) => {
              const valid = restoreRun(item);
              if (valid.status === "running") {
                paused = true;
                return pauseRun(valid);
              }
              return valid;
            });
            setRuns(restored);
            setActiveId(restored.some((item) => item.id === parsed.activeId) ? parsed.activeId! : restored[0].id);
            setGoalDraft(restored.find((item) => item.id === parsed.activeId)?.goal || restored[0].goal);
            setMemoryBank(Array.isArray(parsed.memory) ? parsed.memory : restored[0].memory);
            setRestoreNotice(paused);
          }
        }
      } catch {
        setNotice("本地检查点无法恢复，已载入新的演示线程。");
      }
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ runs, activeId, memory: memoryBank }));
  }, [runs, activeId, memoryBank, hydrated]);

  useEffect(() => {
    void fetch("/api/capabilities", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: unknown) => setCapabilities(data as Capabilities))
      .catch(() => setCapabilities(null));
  }, []);

  useEffect(() => {
    if (!autoRun || (run.status !== "planned" && run.status !== "running")) return;
    const timer = window.setTimeout(() => {
      setRuns((current) => current.map((item) => item.id === activeId
        ? advanceRun(item, scenarioOptions(item, scenario)) : item));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [autoRun, run.status, run.checkpoint.revision, activeId, scenario]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const apply = (transform: (current: Run) => Run) => {
    setRuns((current) => current.map((item) => item.id === activeId ? transform(item) : item));
  };
  const create = () => {
    const goal = goalDraft.trim();
    if (!goal) { setNotice("先写下你的研究目标。"); return; }
    const next = createRun(goal, { id: `run-${crypto.randomUUID()}`, memory: memoryBank });
    setRuns((current) => [next, ...current]);
    setActiveId(next.id);
    setAutoRun(false);
    setView("workbench");
    setInspectorTab("trace");
    setSelectedEvidenceId(null);
    setRestoreNotice(false);
    setNotice(next.status === "stopped" ? next.stopReason || "该标的暂不支持演示。" : "五步研究计划已生成。");
  };
  const start = () => {
    if (run.status === "paused") apply(resumeRun);
    if (run.status === "failed") {
      apply(retryRun);
      if (scenario === "failure") setScenario("normal");
    }
    setAutoRun(true);
    setRestoreNotice(false);
  };
  const manualAdvance = () => {
    if (run.status === "paused") apply((item) => {
      const resumed = resumeRun(item);
      return resumed.status === "running" ? advanceRun(resumed, scenarioOptions(resumed, scenario)) : resumed;
    });
    else if (run.status === "failed") apply((item) => {
      const retried = retryRun(item);
      return advanceRun(retried, scenario === "failure" ? {} : scenarioOptions(retried, scenario));
    });
    else apply((item) => advanceRun(item, scenarioOptions(item, scenario)));
    setAutoRun(false);
    setRestoreNotice(false);
  };
  const saveMemory = () => {
    if (!memoryDraft.trim()) return;
    const next = updateMemory({ ...run, memory: memoryBank }, memoryDraft, memoryKind);
    setRuns((current) => current.map((item) => item.id === activeId ? next : item));
    setMemoryBank(next.memory);
    setMemoryDraft("");
    setNotice("已写入长期记忆，新线程会继承这条记录。");
  };
  const removeMemory = (id: string) => {
    const next = deleteMemory({ ...run, memory: memoryBank }, id);
    setRuns((current) => current.map((item) => item.id === activeId ? next : item));
    setMemoryBank(next.memory);
  };
  const exportCheckpoint = () => downloadFile(`x-buddy-${run.id}-checkpoint.json`, JSON.stringify(run, null, 2), "application/json");
  const exportReport = () => {
    if (!run.report) return;
    downloadFile(`x-buddy-${run.symbol}-report.md`, reportMarkdown(run), "text/markdown;charset=utf-8");
  };
  const importCheckpoint = async (file: File | undefined) => {
    if (!file) return;
    try {
      let restored = restoreRun(await file.text());
      if (restored.status === "running") restored = pauseRun(restored);
      setRuns((current) => [restored, ...current.filter((item) => item.id !== restored.id)]);
      setActiveId(restored.id);
      setGoalDraft(restored.goal);
      setMemoryBank(restored.memory);
      setView("workbench");
      setAutoRun(false);
      setRestoreNotice(restored.status === "paused");
      setNotice("检查点已载入；可从当前状态继续。");
    } catch {
      setNotice("检查点格式无效，未覆盖现有研究。");
    }
    if (fileInput.current) fileInput.current.value = "";
  };
  const checkLive = async () => {
    setLiveCheck({ state: "loading", message: "正在检查服务端连接…" });
    try {
      const capResponse = await fetch("/api/capabilities", { cache: "no-store" });
      const cap = await capResponse.json() as Capabilities;
      setCapabilities(cap);
      if (!cap.fuyao.configured) {
        setLiveCheck({ state: "unavailable", message: "服务端未配置 HITHINK_FINANCE_API_KEY。演示研究仍可完整运行。" });
        return;
      }
      const response = await fetch("/api/fuyao", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "quote", thscode: "600519.SH" }), cache: "no-store",
      });
      const result = await response.json() as { code: number | string; message: string; request_id: string | null; data: { timestamp?: number; item?: { last_price?: number }[] } | null };
      if (response.ok && result.code === 0) {
        const latest = result.data?.item?.[0]?.last_price;
        setLiveCheck({ state: "ready", message: `扶摇行情快照读取成功${typeof latest === "number" ? ` · 600519.SH ¥${latest.toFixed(2)}` : ""}。真实数据仅用于连接自检，不混入演示报告。`, requestId: result.request_id || undefined, timestamp: result.data?.timestamp ? new Date(result.data.timestamp).toISOString() : undefined });
      } else {
        setLiveCheck({ state: "error", message: `扶摇返回 ${result.code}：${result.message}`, requestId: result.request_id || undefined });
      }
    } catch {
      setLiveCheck({ state: "error", message: "连接自检失败，请检查服务端或网络。" });
    }
  };

  return (
    <div className="xb-app">
      <header className="xb-topbar">
        <div className="xb-topbrand">
          <button className="xb-mobile-menu" aria-label="打开导航" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button>
          <span className="xb-mark">X<span>✦</span></span>
          <div><strong>投资 X Buddy</strong><small>RESEARCH AGENT WORKSPACE</small></div>
        </div>
        <div className="xb-topcenter"><span className="xb-topbreadcrumb">工作台</span><ChevronRight size={14} /><span>{run.company} · {run.symbol}</span></div>
        <div className="xb-topactions">
          <span className="xb-mode-pill"><span className="xb-mode-dot" />本地合成演示</span>
          <button className="xb-top-connection" onClick={() => { setView("tools"); void checkLive(); }} title="检测扶摇连接"><Activity size={15} /><span>数据连接</span><ArrowUpRight size={14} /></button>
        </div>
      </header>

      <div className="xb-shell">
        <aside className={`xb-sidebar ${mobileNavOpen ? "is-open" : ""}`}>
          <div className="xb-mobile-close"><strong>导航</strong><button aria-label="关闭导航" onClick={() => setMobileNavOpen(false)}><X size={19} /></button></div>
          <div className="xb-sidebar-inner">
            <button className="xb-new-button" onClick={() => { setGoalDraft(""); setView("workbench"); setMobileNavOpen(false); document.getElementById("goal-input")?.focus(); }}><Plus size={18} />新建研究<span>⌘ K</span></button>
            <div className="xb-nav-group"><div className="xb-group-label">空间</div>
              <button className={`xb-nav-item ${view === "workbench" ? "active" : ""}`} onClick={() => { setView("workbench"); setMobileNavOpen(false); }}><Layers3 size={17} />研究工作台<ChevronRight size={14} /></button>
              <button className={`xb-nav-item ${view === "memory" ? "active" : ""}`} onClick={() => { setView("memory"); setMobileNavOpen(false); }}><BrainCircuit size={17} />长期记忆<span className="xb-nav-count">{memoryBank.length}</span></button>
              <button className={`xb-nav-item ${view === "tools" ? "active" : ""}`} onClick={() => { setView("tools"); setMobileNavOpen(false); }}><Wrench size={17} />工具与连接<span className="xb-nav-count">{TOOL_REGISTRY.length}</span></button>
            </div>
            <div className="xb-sidebar-rule" />
            <div className="xb-section-title"><span>研究线程</span><span>{runs.length}</span></div>
            <div className="xb-thread-list">{runs.map((item) => (
              <button key={item.id} className={`xb-thread ${item.id === activeId ? "active" : ""}`} onClick={() => { setActiveId(item.id); setGoalDraft(item.goal); setView("workbench"); setAutoRun(false); setSelectedEvidenceId(null); setMobileNavOpen(false); }}>
                <span className="xb-thread-icon"><FileText size={15} /></span><span className="xb-thread-text"><strong>{item.company} · {item.symbol}</strong><small>{item.goal}</small></span><span className={`xb-mini-dot status-${item.status}`} />
              </button>
            ))}</div>
            <div className="xb-sidebar-bottom"><div className="xb-sidebar-hint"><Sparkles size={16} /><span>你的研究过程会自动保存到本机，随时从检查点继续。</span></div><div className="xb-profile"><span className="xb-avatar">研</span><span><strong>个人工作区</strong><small>仅存储于此浏览器</small></span><Settings2 size={16} /></div></div>
          </div>
        </aside>

        <main className="xb-main">
          {view === "workbench" ? <>
            <div className="xb-main-topline"><span><span className="xb-eyebrow-line" />AGENT RESEARCH DESK</span><span>01 / 03 · 研究与执行</span></div>
            <section className="xb-hero"><div><div className="xb-hero-kicker"><Sparkles size={14} /> THINK CLEARER, RESEARCH DEEPER</div><h1>让每一步研究，<br /><em>都有据可查。</em></h1><p>给 X Buddy 一个目标，查看规划、工具调用、人工确认与可追溯成果。</p></div><div className="xb-hero-art" aria-hidden="true"><span className="xb-orbit orbit-one" /><span className="xb-orbit orbit-two" /><span className="xb-orbit orbit-three" /><span className="xb-orbit-core"><span>✦</span></span><span className="xb-art-node n1" /><span className="xb-art-node n2" /><span className="xb-art-node n3" /></div></section>

            <section className="xb-composer" aria-label="研究目标输入"><div className="xb-composer-head"><span><Zap size={16} /> 研究目标</span><span className="xb-composer-tip">当前演示支持 600519.SH</span></div><textarea id="goal-input" value={goalDraft} onChange={(event) => setGoalDraft(event.target.value)} placeholder="例如：研究贵州茅台 600519.SH 的行情、估值与财务变化，指出需要进一步核验的问题…" rows={3} /><div className="xb-composer-bottom"><span><Info size={14} /> 结果将明确区分事实、推断与待核验事项</span><button className="xb-primary" onClick={create}>生成研究计划 <ArrowRight size={17} /></button></div></section>

            <div className="xb-section-heading"><div><span className="xb-overline">CURRENT RESEARCH</span><h2>{run.company} <span>/ {run.symbol}</span></h2><p>{run.goal}</p></div><div className="xb-heading-actions"><span className={`xb-status-badge status-${run.status}`}><span className="xb-status-dot" />{statusText[run.status]}</span><button className="xb-icon-button" onClick={exportCheckpoint} title="导出 JSON 检查点" aria-label="导出 JSON 检查点"><Download size={17} /></button></div></div>
            {restoreNotice && <div className="xb-noticebar"><HardDriveDownload size={17} /><span>已恢复本地检查点，运行保持暂停。确认状态后可继续执行。</span><button onClick={() => setRestoreNotice(false)} aria-label="关闭提示"><X size={16} /></button></div>}
            {run.stopReason && <div className="xb-alertbar"><AlertCircle size={17} /><span>{run.stopReason}</span></div>}
            <div className="xb-metrics"><div><span>任务进度</span><strong>{completeCount}<small> / {run.steps.length}</small></strong><div className="xb-progress"><span style={{ width: `${progress}%` }} /></div></div><div><span>工具调用</span><strong>{run.metrics.toolCalls}<small> 次</small></strong><small>按计划记录</small></div><div><span>预估成本</span><strong>{formatCost(run.metrics.estimatedUsd)}</strong><small>上限 {formatCost(run.limits.maxCostUsd)}</small></div><div><span>检查点</span><strong>V{run.checkpoint.revision}</strong><small>{time(run.checkpoint.savedAt)}</small></div></div>

            <div className="xb-plan-header"><div><span className="xb-overline">EXECUTION PLAN</span><h2>研究计划 <span>· {run.steps.length} 个步骤</span></h2></div><div className="xb-scenario"><label htmlFor="scenario"><Settings2 size={15} />故障情景</label><select id="scenario" value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)} disabled={run.status === "running" || run.status === "waiting_approval"}><option value="normal">正常链路</option><option value="missing">数据缺失</option><option value="stale">数据过期</option><option value="conflict">来源冲突</option><option value="failure">工具失败</option></select><ChevronDown size={14} /></div></div>
            <section className="xb-plan" aria-label="执行计划">{run.steps.map((step, index) => (
              <button key={step.id} className={`xb-step ${step.status}`} onClick={() => { setInspectorTab(step.evidenceIds.length ? "evidence" : "trace"); setSelectedEvidenceId(step.evidenceIds[0] || null); }}>
                <span className="xb-step-rail"><span className="xb-step-icon">{stepIcon(step.status)}</span>{index < run.steps.length - 1 && <span className="xb-step-line" />}</span>
                <span className="xb-step-body"><span className="xb-step-main"><span className="xb-step-number">0{index + 1}</span><strong>{step.title}</strong>{step.requiresApproval && <span className="xb-approval-tag"><ShieldCheck size={12} />人工确认</span>}</span><span className="xb-step-description">{step.description}</span><span className="xb-step-meta"><code>{step.toolId}</code><span>·</span><span>{formatCost(step.estimatedCostUsd)}</span>{step.attempts > 0 && <><span>·</span><span>{step.attempts} 次调用</span></>}{step.evidenceIds.length > 0 && <><span>·</span><span>{step.evidenceIds.length} 条证据</span></>}</span>{step.error && <span className="xb-step-error"><AlertCircle size={13} />{step.error}</span>}{step.dataIssue && <span className="xb-step-error"><AlertCircle size={13} />{step.dataIssue === "missing" ? "数据缺失" : step.dataIssue === "stale" ? "数据过期" : "来源冲突"} · 已在报告中标记</span>}</span>
                <span className={`xb-step-state status-${step.status}`}>{stepText[step.status]}</span>
              </button>
            ))}</section>

            {run.status === "waiting_approval" && run.approval && <section className="xb-approval-card"><div className="xb-approval-symbol"><ShieldCheck size={23} /></div><div className="xb-approval-content"><span className="xb-overline">HUMAN IN THE LOOP</span><h3>需要你的确认</h3><p>{run.approval.reason}</p><div className="xb-approval-actions"><button onClick={() => { apply(approveRun); setAutoRun(true); }} className="xb-primary"><Check size={16} />批准并继续</button><button onClick={() => { apply(rejectRun); setAutoRun(true); }} className="xb-secondary">跳过财务步骤</button></div></div></section>}
            {run.status === "failed" && <section className="xb-recovery-card"><AlertCircle size={19} /><div><strong>执行中断，检查点已保留</strong><p>可以重试失败步骤，之前完成的工具调用不会重复执行。</p></div><button onClick={start}><RotateCcw size={15} />重试</button></section>}
            <div className="xb-run-controls"><div className="xb-control-group">{(run.status === "planned" || run.status === "running" || run.status === "paused" || run.status === "failed") && <button className="xb-primary" onClick={isAutoRunning ? () => { apply(pauseRun); setAutoRun(false); } : start}>{isAutoRunning ? <Pause size={16} /> : run.status === "failed" ? <RotateCcw size={16} /> : <Play size={16} fill="currentColor" />}{isAutoRunning ? "暂停执行" : run.status === "paused" ? "从检查点继续" : run.status === "failed" ? "重试并继续" : "运行研究"}</button>}{(run.status === "planned" || run.status === "running" || run.status === "paused" || run.status === "failed") && <button className="xb-secondary" onClick={manualAdvance}>单步执行 <ChevronRight size={16} /></button>}{(run.status === "running" || run.status === "paused" || run.status === "waiting_approval" || run.status === "failed") && <button className="xb-text-danger" onClick={() => { apply(stopRun); setAutoRun(false); }}><Square size={14} />停止</button>}</div><span>沙盒注入：{scenarioText[scenario]} · 每步自动写入检查点</span></div>

            {run.report && <section className="xb-report"><div className="xb-report-top"><div><span className="xb-overline">RESEARCH OUTPUT</span><h2>{run.report.title}</h2><p>{run.report.summary}</p></div><button className="xb-secondary" onClick={exportReport}><Download size={16} />导出 Markdown</button></div><div className="xb-report-columns"><div><div className="xb-report-label facts"><CheckCircle2 size={17} />事实 <span>{run.report.facts.length}</span></div>{run.report.facts.length ? run.report.facts.map((item, index) => <ReportRow key={index} item={item} onEvidence={(id) => { setSelectedEvidenceId(id); setInspectorTab("evidence"); }} />) : <p className="xb-empty-line">暂无已验证的演示事实。</p>}</div><div><div className="xb-report-label inference"><Sparkles size={17} />推断 <span>{run.report.inferences.length}</span></div>{run.report.inferences.length ? run.report.inferences.map((item, index) => <ReportRow key={index} item={item} onEvidence={(id) => { setSelectedEvidenceId(id); setInspectorTab("evidence"); }} />) : <p className="xb-empty-line">暂无可支持的推断。</p>}</div><div><div className="xb-report-label unknown"><AlertCircle size={17} />待核验 <span>{run.report.unknowns.length}</span></div>{run.report.unknowns.map((item, index) => <ReportRow key={index} item={item} onEvidence={(id) => { setSelectedEvidenceId(id); setInspectorTab("evidence"); }} />)}</div></div><footer><ShieldCheck size={15} />所有数值均为本地合成演示样本。报告不构成投资建议，真实数据需调用授权接口重新核验。</footer></section>}
            <div className="xb-main-footer"><span>INVESTMENT X BUDDY / DEMO HARNESS</span><span>每条结论都可以追溯到原始字段</span></div>
          </> : view === "memory" ? <section className="xb-alt-page"><div className="xb-alt-head"><span className="xb-overline">LONG-TERM STATE</span><h1>长期记忆</h1><p>只保存你明确写下的偏好或研究备注。新研究线程会继承最新记忆，历史线程保留当时快照。</p></div><div className="xb-memory-composer"><div className="xb-memory-top"><BrainCircuit size={21} /><strong>写入一条记忆</strong><select value={memoryKind} onChange={(event) => setMemoryKind(event.target.value as "preference" | "research_note")}><option value="research_note">研究备注</option><option value="preference">个人偏好</option></select></div><textarea value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} placeholder="例如：研究结论先列证据，再列假设；不要自动给出买卖建议。" rows={3} /><div className="xb-memory-actions"><span>这条记录会随下个新建线程进入上下文。</span><button className="xb-primary" onClick={saveMemory}><Plus size={16} />保存记忆</button></div></div><div className="xb-alt-subhead"><h2>已保存的记忆</h2><span>{memoryBank.length} 条</span></div>{memoryBank.length ? <div className="xb-memory-list">{memoryBank.map((item) => <div className="xb-memory-card" key={item.id}><span className="xb-memory-icon">{item.kind === "preference" ? <Sparkles size={17} /> : <BookOpen size={17} />}</span><div><small>{item.kind === "preference" ? "个人偏好" : "研究备注"} · {time(item.updatedAt)}</small><p>{item.text}</p><code>{shortId(item.sourceRunId)}</code></div><button onClick={() => removeMemory(item.id)} title="删除记忆" aria-label="删除记忆"><Trash2 size={16} /></button></div>)}</div> : <div className="xb-empty-state"><BrainCircuit size={29} /><h3>还没有长期记忆</h3><p>写入第一条偏好，下一次研究就能继承它。</p></div>}</section>
          : <section className="xb-alt-page"><div className="xb-alt-head"><span className="xb-overline">TOOL REGISTRY & CONNECTIONS</span><h1>工具与连接</h1><p>工具白名单、确认策略与数据连接一目了然。演示 Harness 使用本地合成样本，接口自检独立读取真实服务。</p></div><div className="xb-connection-card"><div className="xb-connection-icon"><Database size={23} /></div><div className="xb-connection-main"><div><strong>扶摇金融数据 API</strong><span className={`xb-connection-status ${capabilities?.fuyao.configured ? "ready" : "off"}`}>{capabilities?.fuyao.configured ? "服务端已配置" : "尚未配置"}</span></div><p>仅服务端读取 HITHINK_FINANCE_API_KEY。允许行情快照、日 K 与财务三表；真实数据不会混入演示报告。</p><a href="https://fuyao.aicubes.cn/docs/" target="_blank" rel="noreferrer">查看官方文档 <ExternalLink size={13} /></a></div><button className="xb-secondary" onClick={() => void checkLive()} disabled={liveCheck.state === "loading"}>{liveCheck.state === "loading" ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}接口自检</button></div><div className={`xb-live-result ${liveCheck.state}`}><span>{liveCheck.state === "ready" ? <CheckCircle2 size={17} /> : liveCheck.state === "error" ? <XCircle size={17} /> : <Info size={17} />}</span><div><strong>{liveCheck.message}</strong>{liveCheck.requestId && <small>request_id: {liveCheck.requestId}</small>}{liveCheck.timestamp && <small>上游时点：{time(liveCheck.timestamp)}</small>}</div></div><div className="xb-connection-card secondary"><div className="xb-connection-icon"><Layers3 size={22} /></div><div className="xb-connection-main"><div><strong>iFinD MCP</strong><span className="xb-connection-status off">未连接</span></div><p>市场宽度、宏观、政策与资讯能力仅在取得授权并发现可调用工具后使用。当前工作台不声称已连接。</p></div></div><div className="xb-alt-subhead"><h2>Harness 工具注册表</h2><span>{TOOL_REGISTRY.length} 项能力</span></div><div className="xb-tools-list">{TOOL_REGISTRY.map((tool, index) => <div className="xb-tool-row" key={tool.id}><span className="xb-tool-index">0{index + 1}</span><div className="xb-tool-symbol">{tool.permission === "approval" ? <ShieldCheck size={18} /> : <Zap size={18} />}</div><div><strong>{tool.name}</strong><p>{tool.description}</p><code>{tool.id}</code></div><span className={`xb-tool-permission ${tool.permission}`}>{tool.permission === "approval" ? "需确认" : "自动执行"}</span><span className="xb-tool-cost">{formatCost(tool.costUsd)}</span></div>)}</div><div className="xb-connection-foot"><ShieldCheck size={17} />执行遵守步数、时延与成本预算。失败、缺失、过期和冲突会进入运行轨迹与报告待核验区。</div></section>}
        </main>

        <aside className="xb-inspector"><div className="xb-inspector-header"><div><span className="xb-overline">TRANSPARENCY LAYER</span><h2>研究透明层</h2></div><span className="xb-inspector-count">{run.evidence.length} 条证据</span></div><div className="xb-inspector-tabs"><button className={inspectorTab === "evidence" ? "active" : ""} onClick={() => setInspectorTab("evidence")}>证据</button><button className={inspectorTab === "trace" ? "active" : ""} onClick={() => setInspectorTab("trace")}>运行轨迹</button><button className={inspectorTab === "checkpoint" ? "active" : ""} onClick={() => setInspectorTab("checkpoint")}>状态</button></div>
          {inspectorTab === "evidence" ? <div className="xb-inspector-content"><div className="xb-inspector-intro"><Search size={15} />选择一条证据，核对来源、时点与原始字段。</div>{run.evidence.length ? <><div className="xb-evidence-list">{run.evidence.map((item) => <button key={item.id} onClick={() => setSelectedEvidenceId(item.id)} className={`xb-evidence-item ${evidence?.id === item.id ? "selected" : ""}`}><span className="xb-evidence-ico"><Database size={15} /></span><span><strong>{item.label}</strong><small>{item.displayValue} · {item.asOf}</small></span><ChevronRight size={14} /></button>)}</div>{evidence && <EvidenceDetail evidence={evidence} />}</> : <div className="xb-inspector-empty"><Database size={25} /><strong>证据将在执行后出现</strong><span>每条证据都有原始字段、单位和请求 ID。</span></div>}</div>
          : inspectorTab === "trace" ? <div className="xb-inspector-content"><div className="xb-inspector-intro"><Activity size={15} />每个状态转换都会留下记录。</div><div className="xb-trace-list">{[...run.events].reverse().map((event) => <div key={event.id} className="xb-trace-item"><span className="xb-trace-dot" /><div><span><strong>{event.type.replaceAll("_", " ")}</strong><small>{clock(event.at)}</small></span><p>{event.message}</p>{event.stepId && <code>{event.stepId}</code>}</div></div>)}</div></div>
          : <div className="xb-inspector-content"><div className="xb-checkpoint-card"><span className="xb-overline">PERSISTENT CHECKPOINT</span><strong>版本 {run.checkpoint.revision}</strong><small>保存于 {time(run.checkpoint.savedAt)}</small><div><span>已完成步骤</span><b>{run.checkpoint.completedStepIds.length} / {run.steps.length}</b></div><div><span>上下文压缩</span><b>{run.context.compactions} 次</b></div><div><span>当前 Token 估算</span><b>{run.context.tokenEstimate}</b></div></div><div className="xb-context-card"><h3><BrainCircuit size={17} />上下文摘要</h3><p>{run.context.summary || "尚未触发压缩。执行中会保留最近事件；超过阈值后仅压缩工作上下文，原始证据仍可查。"}</p>{run.context.recent.length > 0 && <small>近期：{run.context.recent.at(-1)}</small>}</div><div className="xb-checkpoint-actions"><button className="xb-secondary" onClick={exportCheckpoint}><Download size={15} />导出 JSON</button><button className="xb-secondary" onClick={() => fileInput.current?.click()}><Upload size={15} />导入检查点</button><input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => void importCheckpoint(event.target.files?.[0])} /></div><div className="xb-inspector-foot"><Info size={15} />本机 localStorage 自动保存。刷新后运行中的任务会暂停，等待你继续。</div></div>}
        </aside>
      </div>
      {mobileNavOpen && <button className="xb-mobile-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}
      {notice && <div className="xb-toast" role="status"><Info size={16} />{notice}<button onClick={() => setNotice("")} aria-label="关闭提示"><X size={14} /></button></div>}
    </div>
  );
}

function scenarioOptions(run: Run, scenario: Scenario): AdvanceOptions {
  const next = run.steps.find((step) => step.status === "pending");
  if (scenario === "failure" && next?.id === "market") return { failTool: "fuyao.quote", failureReason: "演示注入：行情工具超时。" };
  if (next?.id === "valuation" && (scenario === "missing" || scenario === "stale" || scenario === "conflict")) {
    return { dataIssue: scenario };
  }
  return {};
}

function ReportRow({ item, onEvidence }: { item: { text: string; evidenceIds: string[] }; onEvidence: (id: string) => void }) {
  return <div className="xb-report-row"><p>{item.text}</p>{item.evidenceIds.length > 0 && <div>{item.evidenceIds.slice(0, 3).map((id) => <button key={id} onClick={() => onEvidence(id)}><ArrowUpRight size={12} />{shortId(id)}</button>)}{item.evidenceIds.length > 3 && <small>+{item.evidenceIds.length - 3}</small>}</div>}</div>;
}

function EvidenceDetail({ evidence }: { evidence: Evidence }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(`${evidence.rawField}=${evidence.rawValue}; source=${evidence.source}; asOf=${evidence.asOf}; request_id=${evidence.requestId}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return <div className="xb-evidence-detail"><div className="xb-evidence-detail-head"><span className="xb-overline">SOURCE RECORD</span><span className={`xb-quality ${evidence.quality}`}>{evidence.quality === "ok" ? "可用样本" : evidence.quality === "stale" ? "过期" : "冲突"}</span></div><h3>{evidence.label}</h3><strong className="xb-evidence-value">{evidence.displayValue}</strong><dl><div><dt>数据来源</dt><dd>{evidence.source}</dd></div><div><dt>标的 / 时点</dt><dd>{evidence.symbol} · {evidence.asOf}</dd></div><div><dt>原始字段</dt><dd><code>{evidence.rawField}</code></dd></div><div><dt>原始值 / 单位</dt><dd>{String(evidence.rawValue)} · {evidence.unit}</dd></div><div><dt>统计口径</dt><dd>{evidence.methodology}</dd></div><div><dt>请求 ID</dt><dd><code>{evidence.requestId}</code></dd></div></dl><button onClick={() => void copy()}><Copy size={14} />{copied ? "已复制" : "复制溯源信息"}</button><p className="xb-evidence-demo">本地合成样本 · 非实时金融信息</p></div>;
}
