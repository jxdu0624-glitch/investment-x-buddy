"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertCircle, ArrowRight, BookOpen, BrainCircuit, Check,
  CheckCircle2, ChevronDown, ChevronRight, Circle, Copy, Database,
  Download, ExternalLink, FileText, Info, Loader2, Menu, Pause, Play,
  Plus, RefreshCw, RotateCcw, Settings2, ShieldCheck, Square,
  Trash2, Upload, Wrench, X, XCircle,
} from "lucide-react";
import {
  advanceRun, approveRun, createRun, deleteMemory, pauseRun, rejectRun,
  restoreRun, resumeRun, retryRun, stopRun, TOOL_REGISTRY, updateMemory,
  type AdvanceOptions, type Evidence, type MemoryRecord, type Run,
  type ResearchFocus, type RunStatus, type StepStatus,
} from "@/lib/harness";

type View = "workbench" | "memory" | "tools";
type Scenario = "normal" | "missing" | "stale" | "conflict" | "failure";
type Capabilities = {
  fuyao: { configured: boolean; status: string; tools: string[]; limits: Record<string, number> };
  ifind: { configured: boolean; status: string };
};
type LiveCheck = { state: "idle" | "loading" | "ready" | "unavailable" | "error"; message: string; requestId?: string; timestamp?: string };

const STORAGE_KEY = "investment-x-buddy-runs-v1";
const QUESTIONS: { focus: ResearchFocus; title: string; hint: string; goal: string }[] = [
  { focus: "valuation", title: "当前估值与上半年业绩，能说明什么？", hint: "把估值水平与已知财务增速放在一起看", goal: "研究贵州茅台 600519.SH：当前估值与上半年业绩，能说明什么？" },
  { focus: "performance", title: "营收和利润增长是否同步？", hint: "核对两项增速，并留下口径缺口", goal: "研究贵州茅台 600519.SH：营收和利润增长是否同步？" },
  { focus: "market", title: "单日涨跌能解释原因吗？", hint: "区分行情事实与尚无证据的原因", goal: "研究贵州茅台 600519.SH：单日涨跌能解释原因吗？" },
];
const DEFAULT_GOAL = QUESTIONS[0].goal;
const INITIAL_RUN = createRun(DEFAULT_GOAL, { id: "welcome-demo", focus: "valuation" });

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
const focusLabel: Record<ResearchFocus, string> = {
  valuation: "估值与上半年业绩",
  performance: "营收与利润增速",
  market: "单日行情与归因边界",
};

function validateGoal(goal: string, focus: ResearchFocus): string | null {
  if (!goal) return "请先填写关于贵州茅台的研究问题。";
  const codes = [...goal.matchAll(/(?:^|[^\d])([036]\d{5})(?:\.(SH|SZ))?(?!\d)/gi)];
  if (codes.some((match) => match[1] !== "600519" || (match[2] && match[2].toUpperCase() !== "SH"))) return "当前演示只支持贵州茅台 600519.SH，不能用于其他标的。";
  if (!goal.includes("贵州茅台") && !goal.includes("600519")) return "请在问题中明确写出“贵州茅台”或“600519.SH”，避免研究对象混淆。";
  if (/(对比|比较|相比|相较|相对于|竞品|同业|同行|别的公司|其他公司|另一家公司|vs\.?)/i.test(goal)) return "当前只支持贵州茅台的三个单标的问题，暂不支持跨标的或额外比较。";
  if (/(未来|预测|明年|后市|涨到|跌到|收益率)/.test(goal)) return "当前只能核查演示样本中的历史字段，无法预测未来走势或收益。";
  if (focus === "valuation" && !/(估值|市盈率|PE)/i.test(goal)) return "当前选择了“估值与上半年业绩”，请提出对应问题，或选择其他研究方向。";
  if (focus === "valuation" && /(变化|趋势|历史|过去)/.test(goal)) return "当前只有单时点估值样本，无法回答估值变化或历史趋势问题。";
  if (focus === "performance" && (!/(营收|收入)/.test(goal) || !/利润/.test(goal))) return "当前选择了“营收与利润增速”，问题需同时提到收入和利润。";
  if (focus === "market" && (!/(股价|价格|涨跌|波动|行情|收盘)/.test(goal) || !/(单日|当日|当天)/.test(goal))) return "当前选择了“单日行情”，问题需明确是单日或当日行情。";
  return null;
}
function mergeMemoryRecords(older: MemoryRecord[], newer: MemoryRecord[]) {
  return [...new Map([...older, ...newer].map((record) => [record.id, record])).values()];
}

function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai", hour12: false });
}
function clock(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Shanghai", hour12: false });
}
function formatCost(value: number) { return `$${value.toFixed(4)}`; }
function questionTitle(run: Run) {
  const exactTemplate = QUESTIONS.find((item) => item.goal === run.goal);
  if (exactTemplate) return exactTemplate.title;
  return run.goal.replace(/^研究贵州茅台\s*600519\.SH[：:]?\s*/, "").trim() || "贵州茅台研究";
}

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
  return `# ${report.title}\n\n> 本地合成数据演示 · 非实时金融信息 · 非投资建议\n\n研究目标：${run.goal}\n演示事件时间：${report.generatedAt}\n运行 ID：${run.id}\n\n## 对研究问题的回答\n\n${list([report.answer || { text: report.summary, evidenceIds: [] }])}\n\n## 事实\n\n${list(report.facts)}\n\n## 推断\n\n${list(report.inferences)}\n\n## 待核验与缺口\n\n${list(report.unknowns)}\n\n## 下一步核验\n\n${list(report.nextChecks || [])}\n\n## 证据索引\n\n${evidence}\n`;
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
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [goalDraft, setGoalDraft] = useState(DEFAULT_GOAL);
  const [goalError, setGoalError] = useState("");
  const [focusDraft, setFocusDraft] = useState<ResearchFocus>("valuation");
  const [showComposer, setShowComposer] = useState(true);
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
  const memoryBankRef = useRef<MemoryRecord[]>([]);

  const run = useMemo(() => runs.find((item) => item.id === activeId) || runs[0], [runs, activeId]);
  const evidence = useMemo(() => run.evidence.find((item) => item.id === selectedEvidenceId) || null, [run.evidence, selectedEvidenceId]);
  const completeCount = run.steps.filter((item) => item.status === "completed").length;
  const skippedCount = run.steps.filter((item) => item.status === "skipped").length;
  const progress = Math.round(((completeCount + skippedCount) / run.steps.length) * 100);
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
            setFocusDraft(restored.find((item) => item.id === parsed.activeId)?.focus || "valuation");
            const restoredMemory = Array.isArray(parsed.memory) ? parsed.memory : restored[0].memory;
            memoryBankRef.current = restoredMemory;
            setMemoryBank(restoredMemory);
            setRestoreNotice(paused);
            setShowComposer(false);
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
    memoryBankRef.current = memoryBank;
  }, [memoryBank]);

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

  useEffect(() => {
    if (!selectedEvidenceId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedEvidenceId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedEvidenceId]);

  const apply = (transform: (current: Run) => Run) => {
    setRuns((current) => current.map((item) => item.id === activeId ? transform(item) : item));
  };
  const pauseForNavigation = () => {
    setAutoRun(false);
    setRuns((current) => current.map((item) => item.id === activeId && item.status === "running" ? pauseRun(item) : item));
  };
  const create = () => {
    const goal = goalDraft.trim();
    const error = validateGoal(goal, focusDraft);
    if (error) { setGoalError(error); setNotice(error); return; }
    setGoalError("");
    const next = createRun(goal, { id: `run-${crypto.randomUUID()}`, memory: memoryBank, focus: focusDraft });
    setRuns((current) => [next, ...current.map((item) => item.id === activeId && item.status === "running" ? pauseRun(item) : item)]);
    setActiveId(next.id);
    setAutoRun(false);
    setView("workbench");
    setSelectedEvidenceId(null);
    setShowComposer(false);
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
  const addMemory = (text: string, kind: "preference" | "research_note") => {
    const id = `memory-${crypto.randomUUID()}`;
    const previousMemory = memoryBankRef.current;
    const nextMemory = updateMemory({ ...run, memory: previousMemory }, text, kind, id).memory;
    memoryBankRef.current = nextMemory;
    setMemoryBank(nextMemory);
    setRuns((current) => current.map((item) => item.id === activeId
      ? updateMemory({ ...item, memory: mergeMemoryRecords(item.memory, previousMemory) }, text, kind, id)
      : item));
  };
  const saveMemory = () => {
    if (!memoryDraft.trim()) return;
    addMemory(memoryDraft.trim(), memoryKind);
    setMemoryDraft("");
    setNotice("已写入长期记忆，新线程会继承这条记录。");
  };
  const saveResearchNote = (text: string) => {
    if (memoryBankRef.current.some((item) => item.kind === "research_note" && item.text === text)) {
      setNotice("这条核验事项已存入研究笔记。");
      return;
    }
    addMemory(text, "research_note");
    setNotice("已存入研究笔记；下次新建研究会继承。");
  };
  const removeMemory = (id: string) => {
    const nextMemory = memoryBankRef.current.filter((item) => item.id !== id);
    memoryBankRef.current = nextMemory;
    setMemoryBank(nextMemory);
    setRuns((current) => current.map((item) => item.id === activeId ? deleteMemory(item, id) : item));
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
      restored = { ...restored, memory: mergeMemoryRecords(restored.memory, memoryBankRef.current) };
      setRuns((current) => [restored, ...current.filter((item) => item.id !== restored.id).map((item) => item.id === activeId && item.status === "running" ? pauseRun(item) : item)]);
      setActiveId(restored.id);
      setGoalDraft(restored.goal);
      setFocusDraft(restored.focus || "valuation");
      memoryBankRef.current = mergeMemoryRecords(restored.memory, memoryBankRef.current);
      setMemoryBank(memoryBankRef.current);
      setView("workbench");
      setShowComposer(false);
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


  const activeStep = run.steps.find((step) => step.status === "waiting_approval" || step.status === "pending" || step.status === "running" || step.status === "failed");
  const financialStep = run.steps.find((step) => step.id === "financial");
  const openEvidence = (id: string) => setSelectedEvidenceId(id);

  return (
    <div className="xb-app">
      <header className="xb-topbar">
        <div className="xb-brand"><span className="xb-brand-mark">X</span><span><strong>投资 X Buddy</strong><small>个人研究工作台</small></span></div>
        <div className="xb-header-right">
          <span className="xb-demo-tag"><span />合成数据演示</span>
          <button className="xb-header-link" onClick={() => { pauseForNavigation(); setView("tools"); void checkLive(); }}><Activity size={17} />数据连接</button>
          <button className="xb-mobile-menu" aria-label="打开导航" onClick={() => setMobileNavOpen(true)}><Menu size={21} /></button>
        </div>
      </header>

      <div className="xb-layout">
        <aside className={"xb-sidebar " + (mobileNavOpen ? "is-open" : "")}>
          <div className="xb-mobile-close"><strong>导航</strong><button aria-label="关闭导航" onClick={() => setMobileNavOpen(false)}><X size={20} /></button></div>
          <div className="xb-sidebar-inner">
            <button className="xb-new-button" onClick={() => { pauseForNavigation(); setGoalDraft(""); setGoalError(""); setFocusDraft("valuation"); setShowComposer(true); setView("workbench"); setMobileNavOpen(false); window.setTimeout(() => document.getElementById("goal-input")?.focus(), 0); }}><Plus size={19} />新建研究</button>
            <nav aria-label="主导航" className="xb-nav">
              <button className={view === "workbench" ? "active" : ""} onClick={() => { setView("workbench"); setMobileNavOpen(false); }}><FileText size={18} />研究工作台</button>
              <button className={view === "memory" ? "active" : ""} onClick={() => { pauseForNavigation(); setView("memory"); setMobileNavOpen(false); }}><BrainCircuit size={18} />研究偏好 <span>{memoryBank.length}</span></button>
              <button className={view === "tools" ? "active" : ""} onClick={() => { pauseForNavigation(); setView("tools"); setMobileNavOpen(false); }}><Wrench size={18} />数据与工具</button>
            </nav>
            <div className="xb-sidebar-heading">研究记录 <span>{runs.length}</span></div>
            <div className="xb-thread-list">{runs.map((item) => (
              <button key={item.id} className={"xb-thread " + (item.id === activeId ? "active" : "")} onClick={() => { pauseForNavigation(); setActiveId(item.id); setGoalDraft(item.goal); setFocusDraft(item.focus || "valuation"); setView("workbench"); setShowComposer(false); setSelectedEvidenceId(null); setMobileNavOpen(false); }}>
                <span className="xb-thread-title">{questionTitle(item)}</span>
                <span className="xb-thread-meta"><span className={"xb-thread-dot " + item.status} />{statusText[item.status]} · {item.symbol}</span>
              </button>
            ))}</div>
            <p className="xb-sidebar-foot">研究记录与偏好保存在当前浏览器。清除站点数据后无法恢复，建议导出重要报告。</p>
          </div>
        </aside>

        <main className="xb-main">
          {view === "workbench" ? <div className="xb-page">
            <div className="xb-page-heading"><div><span className="xb-eyebrow">个人研究 / 贵州茅台</span><h1>研究工作台</h1><p>从一个具体问题开始，逐项核查依据，再形成可追溯的研究简报。</p></div>{!showComposer && <button className="xb-outline-button" onClick={() => { setShowComposer(true); setGoalDraft(""); setGoalError(""); }}><Plus size={17} />新问题</button>}</div>

            <div className="xb-boundary" role="note"><Info size={19} /><div><strong>当前演示对象固定为贵州茅台 600519.SH</strong><p>所有研究数值均为人为构造的合成样本。行情与估值样本时点为 2026-09-30，财务样本期末为 2026-06-30；不代表实时行情、公司公告或投资建议。</p></div></div>

            {showComposer && <section className="xb-compose-card" aria-label="新研究">
              <div className="xb-section-head"><span className="xb-eyebrow">新研究</span><h2>你想核查什么？</h2><p>先选一个问题，也可以改写。当前仅支持贵州茅台与下列三个研究方向。</p></div>
              <div className="xb-question-grid">{QUESTIONS.map((item, index) => <button key={item.focus} className={"xb-question " + (focusDraft === item.focus ? "selected" : "")} onClick={() => { setFocusDraft(item.focus); setGoalDraft(item.goal); setGoalError(""); }}>
                <span className="xb-question-number">0{index + 1}</span><strong>{item.title}</strong><small>{item.hint}</small><span className="xb-question-indicator">{focusDraft === item.focus ? <Check size={16} /> : <ArrowRight size={16} />}</span>
              </button>)}</div>
              <label className="xb-field-label" htmlFor="goal-input">关于这只股票的问题</label>
              <textarea id="goal-input" value={goalDraft} onChange={(event) => { setGoalDraft(event.target.value); setGoalError(""); }} aria-invalid={Boolean(goalError)} aria-describedby={goalError ? "goal-error" : undefined} placeholder="例如：研究贵州茅台 600519.SH 的营收和利润增速是否同步？" rows={2} />
              {goalError && <p className="xb-field-error" id="goal-error"><AlertCircle size={16} />{goalError}</p>}
              <div className="xb-compose-actions"><span>当前方向：{focusLabel[focusDraft]}。将先展示计划，由你决定何时执行。</span><button className="xb-primary" onClick={create}>查看研究计划 <ArrowRight size={17} /></button></div>
            </section>}

            <section className="xb-current-head">
              <div><span className="xb-eyebrow">当前研究 · {run.symbol}</span><h2>{questionTitle(run)}</h2><p>{run.goal}</p></div>
              <span className={"xb-status " + run.status}><span />{statusText[run.status]}</span>
            </section>

            {run.report && <section className="xb-brief" aria-label="研究简报">
              <div className="xb-brief-heading"><div><span className="xb-eyebrow">研究简报 / 合成样本</span><h2>对这个问题的回答</h2></div><button className="xb-outline-button" onClick={exportReport}><Download size={17} />导出报告</button></div>
              <div className="xb-answer"><p>{run.report.answer?.text || run.report.summary}</p><EvidenceLinks ids={run.report.answer?.evidenceIds || []} onEvidence={openEvidence} /></div>
              <div className="xb-brief-columns">
                <div><h3><CheckCircle2 size={18} />样本中可核对的事实</h3>{run.report.facts.length ? run.report.facts.map((item, index) => <ReportRow key={index} item={item} onEvidence={openEvidence} />) : <p className="xb-empty-line">现有样本不足以列出可用事实。</p>}</div>
                <div><h3><BookOpen size={18} />基于事实的判断</h3>{run.report.inferences.length ? run.report.inferences.map((item, index) => <ReportRow key={index} item={item} onEvidence={openEvidence} />) : <p className="xb-empty-line">暂无足够依据支持进一步判断。</p>}</div>
              </div>
              <div className="xb-brief-followup">
                <div><h3><AlertCircle size={18} />还不能判断</h3>{run.report.unknowns.map((item, index) => <ReportRow key={index} item={item} onEvidence={openEvidence} />)}</div>
                <div><h3><ArrowRight size={18} />下一步核验</h3>{(run.report.nextChecks || []).length ? run.report.nextChecks.map((item, index) => <ReportRow key={index} item={item} onEvidence={openEvidence} onSave={() => saveResearchNote(item.text)} saved={memoryBank.some((memory) => memory.kind === "research_note" && memory.text === item.text)} />) : <p className="xb-empty-line">先补齐待核验信息，再重新形成判断。</p>}</div>
              </div>
              <div className="xb-brief-foot"><ShieldCheck size={17} />这是流程演示报告。所有数字都是合成样本，不能用于实际投资决策。</div>
            </section>}

            {restoreNotice && <div className="xb-noticebar"><Info size={18} />已从本地检查点恢复，运行保持暂停。核对状态后可继续。<button onClick={() => setRestoreNotice(false)} aria-label="关闭提示"><X size={16} /></button></div>}

            {run.status !== "completed" && <section className={"xb-action " + run.status} aria-label="当前操作">
              {run.status === "waiting_approval" && run.approval ? <>
                <div className="xb-action-icon"><ShieldCheck size={23} /></div>
                <div className="xb-action-body"><span className="xb-eyebrow">需要你决定</span><h2>是否继续核查财务样本？</h2><p>为回答“{questionTitle(run)}”，下一步将读取合成的营业收入同比和归母净利润同比字段。</p>
                  <div className="xb-approval-facts"><div><strong>将新增什么</strong><span>2026 年上半年营收与归母净利润同比两个合成字段；模拟成本 {formatCost(financialStep?.estimatedCostUsd || 0)}、时延 620 ms。</span></div><div><strong>跳过会怎样</strong><span>报告继续生成，但会标明财务证据缺口，不把缺失数据写成结论。</span></div></div>
                  <details className="xb-approval-detail"><summary>查看完整审批说明</summary><p>{run.approval.reason}</p></details>
                  <div className="xb-action-buttons"><button className="xb-primary" onClick={() => { apply(approveRun); setAutoRun(true); }}><Check size={17} />确认并继续</button><button className="xb-outline-button" onClick={() => { apply(rejectRun); setAutoRun(true); }}>跳过并标记缺口</button><button className="xb-quiet-danger" onClick={() => { apply(stopRun); setAutoRun(false); }}><Square size={15} />停止研究</button></div>
                </div>
              </> : <>
                <div className="xb-action-icon">{run.status === "failed" || run.status === "stopped" ? <AlertCircle size={23} /> : run.status === "paused" ? <Pause size={22} /> : <Play size={22} />}</div>
                <div className="xb-action-body">
                  <span className="xb-eyebrow">当前操作</span>
                  <h2>{run.status === "planned" ? "计划已就绪，等待你开始" : run.status === "running" ? "正在核查：" + (activeStep?.title || "研究数据") : run.status === "paused" ? "研究已暂停" : run.status === "failed" ? "这一步没有完成" : "本次研究已停止"}</h2>
                  <p>{run.stopReason || (run.status === "failed" ? (activeStep?.error || "工具调用失败。前面的核查结果和检查点仍保留。") : run.status === "paused" ? "已完成步骤不会重新运行，可从当前检查点继续。" : run.status === "planned" ? "计划分五步核查样本字段；财务步骤会等待你的确认。" : "每完成一步都会更新证据与执行状态。")}</p>
                  {(run.status === "planned" || run.status === "running" || run.status === "paused" || run.status === "failed") && <div className="xb-action-buttons">
                    <button className="xb-primary" onClick={isAutoRunning ? () => { apply(pauseRun); setAutoRun(false); } : start}>{isAutoRunning ? <Pause size={17} /> : run.status === "failed" ? <RotateCcw size={17} /> : <Play size={17} />}{isAutoRunning ? "暂停执行" : run.status === "paused" ? "从检查点继续" : run.status === "failed" ? "重试失败步骤" : run.status === "running" ? "继续自动执行" : "开始研究"}</button>
                    <button className="xb-outline-button" onClick={manualAdvance}>单步执行 <ChevronRight size={17} /></button>
                    {(run.status === "running" || run.status === "paused" || run.status === "failed") && <button className="xb-quiet-danger" onClick={() => { apply(stopRun); setAutoRun(false); }}><Square size={15} />停止研究</button>}
                  </div>}
                </div>
              </>}
            </section>}

            <section className="xb-plan-section">
              <div className="xb-section-title"><div><span className="xb-eyebrow">研究过程</span><h2>研究计划</h2><p>每一步说明会核查什么；完成后可从证据卡片检查原始字段。</p></div><span className="xb-progress-label">{completeCount} 已完成{skippedCount > 0 ? ` · ${skippedCount} 已跳过` : ""} / {run.steps.length}</span></div>
              <div className="xb-progress"><span style={{ width: progress + "%" }} /></div>
              <div className="xb-plan">{run.steps.map((step, index) => <div className={"xb-step " + step.status} key={step.id}>
                <span className="xb-step-index">{stepIcon(step.status)}<small>0{index + 1}</small></span>
                <div className="xb-step-copy"><div><strong>{step.title}</strong>{step.requiresApproval && <span className="xb-step-approval">需你确认</span>}</div><p>{step.description}</p>{step.error && <small className="xb-step-error">{step.error}</small>}{step.dataIssue && <small className="xb-step-error">{step.dataIssue === "missing" ? "数据缺失" : step.dataIssue === "stale" ? "数据过期" : "来源冲突"}，已在报告中标记</small>}{step.evidenceIds.length > 0 && <EvidenceLinks ids={step.evidenceIds} onEvidence={openEvidence} />}</div>
                <span className="xb-step-status">{stepText[step.status]}</span>
              </div>)}</div>
            </section>

            <section className="xb-evidence-section">
              <div className="xb-section-title"><div><span className="xb-eyebrow">依据</span><h2>证据清单</h2><p>点击样本字段，查看来源、时点、单位、计算口径和请求 ID。</p></div><span className="xb-progress-label">{run.evidence.length} 条</span></div>
              {run.evidence.length ? <div className="xb-evidence-grid">{run.evidence.map((item) => <button key={item.id} className="xb-evidence-card" onClick={() => openEvidence(item.id)}><span><Database size={17} />{item.label}</span><strong>{item.displayValue}</strong><small>{item.asOf} · {item.quality === "ok" ? "可用样本" : item.quality === "stale" ? "过期" : "冲突"}<ChevronRight size={16} /></small></button>)}</div> : <div className="xb-empty-panel"><Database size={22} /><span>执行研究后，核查过的样本字段会出现在这里。</span></div>}
            </section>

            <details className="xb-details"><summary><span><Settings2 size={19} />执行记录与演示设置</span><ChevronDown size={18} /></summary>
              <div className="xb-details-content">
                <p className="xb-details-intro">这里展示 Agent Harness 的工具调用、检查点、上下文压缩及故障模拟。成本和耗时是固定演示估算，不代表真实账单或网络时延。</p>
                <div className="xb-metrics"><div><span>工具调用</span><strong>{run.metrics.toolCalls} 次</strong></div><div><span>演示估算成本</span><strong>{formatCost(run.metrics.estimatedUsd)}</strong></div><div><span>模拟累计耗时</span><strong>{run.metrics.elapsedMs} ms</strong></div><div><span>检查点</span><strong>版本 {run.checkpoint.revision}</strong></div></div>
                <div className="xb-details-grid"><section><h3>故障模拟</h3><p>用于查看缺失、过期、冲突与工具失败时，报告如何降级。</p><label htmlFor="scenario">选择情景</label><select id="scenario" value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)} disabled={run.status === "running" || run.status === "waiting_approval"}><option value="normal">正常链路</option><option value="missing">估值数据缺失</option><option value="stale">估值数据过期</option><option value="conflict">估值来源冲突</option><option value="failure">行情工具失败</option></select><small>当前：{scenarioText[scenario]}。情景会作用于下一次未完成步骤。</small></section>
                  <section><h3>检查点与上下文</h3><p>已完成步骤：{run.checkpoint.completedStepIds.length} / {run.steps.length}；上下文压缩：{run.context.compactions} 次；Token 估算：{run.context.tokenEstimate}。</p><p>{run.context.summary || "尚未触发压缩。原始证据会独立保留。"}</p><div className="xb-file-actions"><button className="xb-outline-button" onClick={exportCheckpoint}><Download size={16} />导出检查点</button><button className="xb-outline-button" onClick={() => fileInput.current?.click()}><Upload size={16} />导入检查点</button></div><input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(event) => void importCheckpoint(event.target.files?.[0])} /><small>自动保存在本地浏览器；事件时间为演示时钟，并非真实保存时间。</small></section></div>
                <section className="xb-event-section"><h3>运行轨迹</h3><ol>{[...run.events].reverse().map((event) => <li key={event.id}><span>{event.message}</span><small>{event.type.replaceAll("_", " ")} · 演示事件时间 {clock(event.at)}</small></li>)}</ol></section>
              </div>
            </details>
          </div> : view === "memory" ? <section className="xb-alt-page">
            <div className="xb-page-heading"><div><span className="xb-eyebrow">研究设置</span><h1>研究偏好</h1><p>明确记录你希望后续研究遵循的规则与备注。新研究会继承，历史线程保留当时快照。</p></div></div>
            <div className="xb-memory-composer"><div className="xb-memory-top"><BrainCircuit size={21} /><strong>添加一条偏好或备注</strong><select value={memoryKind} onChange={(event) => setMemoryKind(event.target.value as "preference" | "research_note")}><option value="research_note">研究备注</option><option value="preference">个人偏好</option></select></div><textarea value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} placeholder="例如：先列证据，再写判断；对缺失的数据给出核验清单。" rows={3} /><div className="xb-memory-actions"><span>只保存你主动填写的内容；当前浏览器本地存储。</span><button className="xb-primary" onClick={saveMemory}><Plus size={17} />保存记录</button></div></div>
            <div className="xb-section-title"><div><h2>已保存的记录</h2></div><span className="xb-progress-label">{memoryBank.length} 条</span></div>
            {memoryBank.length ? <div className="xb-memory-list">{memoryBank.map((item) => <div className="xb-memory-card" key={item.id}><div><small>{item.kind === "preference" ? "个人偏好" : "研究备注"} · 当前浏览器保存</small><p>{item.text}</p></div><button onClick={() => removeMemory(item.id)} title="删除记忆" aria-label="删除记忆"><Trash2 size={18} /></button></div>)}</div> : <div className="xb-empty-panel"><BookOpen size={22} /><span>尚无记录。添加一条偏好，下一次研究会继承它。</span></div>}
          </section> : <section className="xb-alt-page">
            <div className="xb-page-heading"><div><span className="xb-eyebrow">数据边界</span><h1>数据与工具</h1><p>查看这次演示使用的样本，以及可独立自检的服务端连接。</p></div></div>
            <div className="xb-boundary"><Info size={19} /><div><strong>研究主链路只使用本地合成样本</strong><p>即使扶摇连接成功，真实接口返回值也不会写入当前演示报告。iFinD MCP 尚未连接。</p></div></div>
            <div className="xb-connection-card"><div className="xb-connection-icon"><Database size={22} /></div><div className="xb-connection-main"><div><strong>扶摇金融数据 API</strong><span className={"xb-connection-status " + (capabilities?.fuyao.configured ? "ready" : "off")}>{capabilities?.fuyao.configured ? "服务端已配置" : "尚未配置"}</span></div><p>密钥只在服务端读取，当前允许行情快照、日 K 和财务三表。连接自检独立于演示研究。</p><a href="https://fuyao.aicubes.cn/docs/" target="_blank" rel="noreferrer">官方文档 <ExternalLink size={14} /></a></div><button className="xb-outline-button" onClick={() => void checkLive()} disabled={liveCheck.state === "loading"}>{liveCheck.state === "loading" ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}接口自检</button></div>
            <div className={"xb-live-result " + liveCheck.state}><span>{liveCheck.state === "ready" ? <CheckCircle2 size={18} /> : liveCheck.state === "error" ? <XCircle size={18} /> : <Info size={18} />}</span><div><strong>{liveCheck.message}</strong>{liveCheck.requestId && <small>request_id: {liveCheck.requestId}</small>}{liveCheck.timestamp && <small>上游时点：{time(liveCheck.timestamp)}</small>}</div></div>
            <div className="xb-connection-card secondary"><div className="xb-connection-icon"><Wrench size={22} /></div><div className="xb-connection-main"><div><strong>iFinD MCP</strong><span className="xb-connection-status off">未连接</span></div><p>市场宽度、宏观、政策与资讯能力需要取得授权并确认可调用工具后才能使用。</p></div></div>
            <div className="xb-section-title"><div><h2>演示工具清单</h2><p>权限与成本为研究流程演示配置。</p></div><span className="xb-progress-label">{TOOL_REGISTRY.length} 项</span></div>
            <div className="xb-tools-list">{TOOL_REGISTRY.map((tool) => <div className="xb-tool-row" key={tool.id}><span className="xb-tool-symbol">{tool.permission === "approval" ? <ShieldCheck size={19} /> : <Activity size={19} />}</span><div><strong>{tool.name}</strong><p>{tool.description}</p><code>{tool.id}</code></div><span className={"xb-tool-permission " + tool.permission}>{tool.permission === "approval" ? "需确认" : "自动执行"}</span><small>{formatCost(tool.costUsd)}</small></div>)}</div>
          </section>}
        </main>
      </div>

      {mobileNavOpen && <button className="xb-mobile-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}
      {evidence && <div className="xb-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedEvidenceId(null); }}><div className="xb-evidence-dialog" role="dialog" aria-modal="true" aria-label={"证据详情：" + evidence.label}><div className="xb-dialog-top"><div><span className="xb-eyebrow">证据溯源 · 合成样本</span><h2>{evidence.label}</h2></div><button autoFocus onClick={() => setSelectedEvidenceId(null)} aria-label="关闭证据详情"><X size={20} /></button></div><EvidenceDetail evidence={evidence} /></div></div>}
      {notice && <div className="xb-toast" role="status"><Info size={17} />{notice}<button onClick={() => setNotice("")} aria-label="关闭提示"><X size={15} /></button></div>}
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

function EvidenceLinks({ ids, onEvidence }: { ids: string[]; onEvidence: (id: string) => void }) {
  if (!ids.length) return null;
  return <div className="xb-evidence-links">{ids.map((id, index) => <button key={id} onClick={() => onEvidence(id)}><Database size={14} />查看依据 {index + 1}<span className="sr-only">：{id}</span></button>)}</div>;
}

function ReportRow({ item, onEvidence, onSave, saved }: { item: { text: string; evidenceIds: string[] }; onEvidence: (id: string) => void; onSave?: () => void; saved?: boolean }) {
  return <div className="xb-report-row"><p>{item.text}</p><div className="xb-report-row-actions"><EvidenceLinks ids={item.evidenceIds} onEvidence={onEvidence} />{onSave && <button className="xb-save-note" onClick={onSave} disabled={saved}>{saved ? <Check size={14} /> : <Plus size={14} />}{saved ? "已存入笔记" : "存入研究笔记"}</button>}</div></div>;
}

function EvidenceDetail({ evidence }: { evidence: Evidence }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(`${evidence.rawField}=${evidence.rawValue}; source=${evidence.source}; asOf=${evidence.asOf}; request_id=${evidence.requestId}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return <div className="xb-evidence-detail"><div className="xb-evidence-detail-head"><span className="xb-eyebrow">原始记录</span><span className={`xb-quality ${evidence.quality}`}>{evidence.quality === "ok" ? "可用样本" : evidence.quality === "stale" ? "过期" : "冲突"}</span></div><h3>{evidence.label}</h3><strong className="xb-evidence-value">{evidence.displayValue}</strong><dl><div><dt>数据来源</dt><dd>{evidence.source}</dd></div><div><dt>标的 / 时点</dt><dd>{evidence.symbol} · {evidence.asOf}</dd></div><div><dt>原始字段</dt><dd><code>{evidence.rawField}</code></dd></div><div><dt>原始值 / 单位</dt><dd>{String(evidence.rawValue)} · {evidence.unit}</dd></div><div><dt>统计口径</dt><dd>{evidence.methodology}</dd></div><div><dt>请求 ID</dt><dd><code>{evidence.requestId}</code></dd></div></dl><button onClick={() => void copy()}><Copy size={14} />{copied ? "已复制" : "复制溯源信息"}</button><p className="xb-evidence-demo">本地合成样本 · 非实时金融信息</p></div>;
}
