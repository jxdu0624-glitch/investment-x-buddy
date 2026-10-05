import {
  DEMO_COMPANY,
  DEMO_FINANCIAL_METRICS,
  DEMO_MARKET_METRICS,
  DEMO_RETRIEVED_AT,
  DEMO_SYMBOL,
  DEMO_VALUATION_METRICS,
  type DemoMetric,
} from "./demo-data";

export type RunStatus =
  | "planned"
  | "running"
  | "waiting_approval"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";
export type StepStatus = "pending" | "running" | "waiting_approval" | "completed" | "failed" | "skipped";
export type DataIssue = "missing" | "stale" | "conflict";
export type EvidenceQuality = "ok" | "stale" | "conflict";
export type MemoryKind = "preference" | "research_note";

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  permission: "auto" | "approval";
  costUsd: number;
}

export const TOOL_REGISTRY: ToolDefinition[] = [
  { id: "scope.parse", name: "研究范围解析", description: "解析股票代码并限定演示研究范围", permission: "auto", costUsd: 0 },
  { id: "fuyao.quote", name: "行情快照", description: "读取本地合成的扶摇行情字段演示样本", permission: "auto", costUsd: 0.0012 },
  { id: "fuyao.valuation", name: "估值观察", description: "读取本地合成的扶摇估值字段演示样本", permission: "auto", costUsd: 0.0018 },
  { id: "fuyao.financial", name: "财务交叉验证", description: "经确认后读取本地合成的财务字段演示样本", permission: "approval", costUsd: 0.0024 },
  { id: "research.synthesize", name: "可追溯研究摘要", description: "区分演示事实、推断和待核验信息", permission: "auto", costUsd: 0.0036 },
];

export interface Step {
  id: string;
  title: string;
  description: string;
  toolId: string;
  status: StepStatus;
  requiresApproval: boolean;
  approved?: boolean;
  attempts: number;
  estimatedCostUsd: number;
  elapsedMs: number;
  evidenceIds: string[];
  dataIssue?: DataIssue;
  error?: string;
}

export interface Evidence {
  id: string;
  stepId: string;
  label: string;
  source: string;
  symbol: string;
  asOf: string;
  retrievedAt: string;
  unit: string;
  methodology: string;
  rawField: string;
  rawValue: string | number;
  displayValue: string;
  requestId: string;
  quality: EvidenceQuality;
  demo: true;
}

export interface ReportItem {
  text: string;
  evidenceIds: string[];
}

export interface Report {
  title: string;
  summary: string;
  facts: ReportItem[];
  inferences: ReportItem[];
  unknowns: ReportItem[];
  generatedAt: string;
}

export interface RunEvent {
  id: string;
  type: string;
  message: string;
  at: string;
  stepId?: string;
}

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  text: string;
  updatedAt: string;
  sourceRunId: string;
}

export interface RunLimits {
  maxSteps: number;
  maxCostUsd: number;
  maxElapsedMs: number;
}

export interface RunMetrics {
  toolCalls: number;
  estimatedUsd: number;
  elapsedMs: number;
  stepsExecuted: number;
}

export interface ContextState {
  summary: string;
  recent: string[];
  tokenEstimate: number;
  compactions: number;
}

export interface RunCheckpoint {
  revision: number;
  savedAt: string;
  completedStepIds: string[];
}

export interface Run {
  id: string;
  goal: string;
  symbol: string;
  company: string;
  mode: "demo";
  status: RunStatus;
  steps: Step[];
  evidence: Evidence[];
  events: RunEvent[];
  context: ContextState;
  memory: MemoryRecord[];
  metrics: RunMetrics;
  limits: RunLimits;
  checkpoint: RunCheckpoint;
  approval?: { stepId: string; reason: string; decision?: "approved" | "rejected" };
  pausedFrom?: RunStatus;
  stopReason?: string;
  report?: Report;
}

export interface CreateRunOptions {
  memory?: MemoryRecord[];
  limits?: Partial<RunLimits>;
  id?: string;
}

export interface AdvanceOptions {
  failTool?: boolean | string;
  failureReason?: string;
  dataIssue?: DataIssue;
}

const BASE_TIME = Date.parse(DEMO_RETRIEVED_AT);
const DEFAULT_LIMITS: RunLimits = { maxSteps: 7, maxCostUsd: 0.03, maxElapsedMs: 6000 };
let fallbackRunCounter = 0;
const STEP_DURATIONS: Record<string, number> = {
  scope: 130,
  market: 420,
  valuation: 470,
  financial: 620,
  synthesis: 560,
};

function clock(index: number): string {
  return new Date(BASE_TIME + index * 1000).toISOString();
}

function hash(text: string): string {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function log(run: Run, type: string, message: string, stepId?: string): void {
  const index = run.events.length;
  run.events.push({ id: `${run.id}-event-${index + 1}`, type, message, at: clock(index), ...(stepId ? { stepId } : {}) });
}

function checkpoint(run: Run): Run {
  run.checkpoint.revision += 1;
  run.checkpoint.savedAt = clock(run.events.length);
  run.checkpoint.completedStepIds = run.steps.filter((step) => step.status === "completed").map((step) => step.id);
  return run;
}

function parseSymbol(goal: string): { symbol: string; explicit: boolean } {
  const match = goal.match(/(?:^|[^\d])([036]\d{5})(?:\.(SH|SZ))?(?!\d)/i);
  if (!match) return { symbol: DEMO_SYMBOL, explicit: false };
  const code = match[1];
  return { symbol: `${code}.${(match[2] || (code.startsWith("6") ? "SH" : "SZ")).toUpperCase()}`, explicit: true };
}

function createStep(id: string, title: string, description: string, toolId: string): Step {
  const tool = TOOL_REGISTRY.find((candidate) => candidate.id === toolId);
  if (!tool) throw new Error(`Unregistered tool: ${toolId}`);
  return {
    id,
    title,
    description,
    toolId,
    status: "pending",
    requiresApproval: tool.permission === "approval",
    attempts: 0,
    estimatedCostUsd: tool.costUsd,
    elapsedMs: 0,
    evidenceIds: [],
  };
}

export function createRun(goal: string, options: CreateRunOptions = {}): Run {
  const cleanGoal = goal.trim() || "研究贵州茅台 600519.SH 的行情、估值与财务信息";
  const parsed = parseSymbol(cleanGoal);
  const uniquePart = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${++fallbackRunCounter}`;
  const run: Run = {
    id: options.id || `run-${hash(cleanGoal)}-${uniquePart}`,
    goal: cleanGoal,
    symbol: parsed.symbol,
    company: parsed.symbol === DEMO_SYMBOL ? DEMO_COMPANY : "未支持标的",
    mode: "demo",
    status: parsed.symbol === DEMO_SYMBOL ? "planned" : "stopped",
    steps: [
      createStep("scope", "确认研究范围", "校验股票代码、工具能力和演示数据边界", "scope.parse"),
      createStep("market", "获取行情快照", "提取演示收盘价及涨跌幅字段", "fuyao.quote"),
      createStep("valuation", "观察估值", "提取演示市盈率及历史分位字段", "fuyao.valuation"),
      createStep("financial", "财务交叉验证", "经用户确认后读取演示财务字段", "fuyao.financial"),
      createStep("synthesis", "形成研究摘要", "生成带证据引用的事实、推断和未知清单", "research.synthesize"),
    ],
    evidence: [],
    events: [],
    context: { summary: "", recent: [], tokenEstimate: 0, compactions: 0 },
    memory: clone(options.memory || []),
    metrics: { toolCalls: 0, estimatedUsd: 0, elapsedMs: 0, stepsExecuted: 0 },
    limits: { ...DEFAULT_LIMITS, ...options.limits },
    checkpoint: { revision: 0, savedAt: clock(0), completedStepIds: [] },
  };
  log(run, "run_created", "已创建演示研究线程；所有数值均为本地合成数据。", "scope");
  log(run, "tools_registered", `已注册 ${TOOL_REGISTRY.length} 项演示能力，其中财务交叉验证需要用户确认。`);
  log(run, "plan_created", "已生成五步可恢复研究计划。", "scope");
  if (!parsed.explicit) {
    log(run, "default_symbol", "未检测到六位股票代码，明确采用贵州茅台 600519.SH 演示默认标的。", "scope");
  }
  if (parsed.symbol !== DEMO_SYMBOL) {
    run.stopReason = `当前演示数据仅支持 ${DEMO_SYMBOL}；${parsed.symbol} 未执行，不能套用演示样本。`;
    log(run, "unsupported_symbol", run.stopReason, "scope");
  }
  return checkpoint(run);
}

function metricsFor(stepId: string): DemoMetric[] {
  if (stepId === "market") return DEMO_MARKET_METRICS;
  if (stepId === "valuation") return DEMO_VALUATION_METRICS;
  if (stepId === "financial") return DEMO_FINANCIAL_METRICS;
  return [];
}

function evidenceFor(run: Run, step: Step, metric: DemoMetric, quality: EvidenceQuality = "ok", suffix = ""): Evidence {
  return {
    id: `ev-${step.id}-${metric.rawField.replace(/[^a-zA-Z0-9]/g, "-")}${suffix}`,
    stepId: step.id,
    label: metric.label,
    source: metric.source,
    symbol: run.symbol,
    asOf: quality === "stale" ? "2023-12-31" : metric.asOf,
    retrievedAt: clock(run.events.length),
    unit: metric.unit,
    methodology: metric.methodology,
    rawField: metric.rawField,
    rawValue: metric.rawValue,
    displayValue: metric.displayValue,
    requestId: `${run.id}-${step.toolId}-${step.attempts}`,
    quality,
    demo: true,
  };
}

function appendContext(run: Run, step: Step): void {
  run.context.recent.push(`${step.title}：${step.status}；证据 ${step.evidenceIds.join(", ") || "无"}`);
  run.context.tokenEstimate += step.id === "scope" ? 180 : 270;
  if (run.context.tokenEstimate > 600) {
    const completed = run.steps.filter((item) => item.status === "completed").map((item) => item.title).join("、");
    const ids = run.evidence.map((item) => item.id).join("、") || "无";
    run.context.summary = `已完成：${completed || "无"}。保留证据引用：${ids}。原始数据仍在 evidence 中；未完成步骤和审批状态以 steps / approval 为准。`;
    run.context.recent = run.context.recent.slice(-1);
    run.context.tokenEstimate = 240;
    run.context.compactions += 1;
    log(run, "context_compacted", "上下文已压缩；保留证据 ID、未完成步骤和审批状态。", step.id);
  }
}

function limitReason(run: Run, step: Step): string | undefined {
  if (run.metrics.stepsExecuted >= run.limits.maxSteps) return "已达到最大执行步数";
  if (run.metrics.estimatedUsd + step.estimatedCostUsd > run.limits.maxCostUsd) return "已达到成本预算上限";
  if (run.metrics.elapsedMs + STEP_DURATIONS[step.id] > run.limits.maxElapsedMs) return "已达到运行时延上限";
  return undefined;
}

/** Advances exactly one executable step, or enters approval before step four. */
export function advanceRun(run: Run, options: AdvanceOptions = {}): Run {
  if (run.status !== "planned" && run.status !== "running") return run;
  const next = clone(run);
  if (next.status === "planned") next.status = "running";
  const step = next.steps.find((candidate) => candidate.status === "pending");
  if (!step) {
    next.status = "completed";
    next.report = makeReport(next);
    log(next, "run_completed", "研究计划已结束，已形成可追溯摘要。");
    return checkpoint(next);
  }
  const reason = limitReason(next, step);
  if (reason) {
    next.status = "stopped";
    next.stopReason = reason;
    log(next, "limit_reached", reason, step.id);
    return checkpoint(next);
  }
  if (step.requiresApproval && !step.approved) {
    step.status = "waiting_approval";
    next.status = "waiting_approval";
    next.approval = {
      stepId: step.id,
      reason: "将读取演示财务字段并增加一次工具成本；请确认是否继续。拒绝后仍可生成注明财务缺口的报告。",
    };
    log(next, "approval_requested", next.approval.reason, step.id);
    return checkpoint(next);
  }
  step.status = "running";
  step.attempts += 1;
  next.metrics.stepsExecuted += 1;
  next.metrics.toolCalls += 1;
  next.metrics.estimatedUsd = Number((next.metrics.estimatedUsd + step.estimatedCostUsd).toFixed(4));
  next.metrics.elapsedMs += STEP_DURATIONS[step.id];
  step.elapsedMs += STEP_DURATIONS[step.id];
  log(next, "tool_called", `调用 ${step.toolId}（本地演示适配器），请求 ${next.id}-${step.toolId}-${step.attempts}。`, step.id);

  const fail = options.failTool === true || options.failTool === step.toolId || options.failTool === step.id;
  if (fail) {
    step.status = "failed";
    step.error = options.failureReason || "演示注入：工具调用失败或超时。";
    next.status = "failed";
    log(next, "tool_failed", `${step.title} 失败：${step.error} 已保留检查点，可重试。`, step.id);
    appendContext(next, step);
    return checkpoint(next);
  }

  if (step.id === "scope") {
    const metric: DemoMetric = {
      label: "研究标的代码",
      source: "用户目标解析 · 本地演示",
      asOf: "2026-10-05",
      unit: "证券代码",
      methodology: "仅将目标中的 600519.SH 解析为受支持的演示标的；未给代码时使用明确默认值",
      rawField: "goal.symbol",
      rawValue: DEMO_SYMBOL,
      displayValue: `${DEMO_COMPANY} · ${DEMO_SYMBOL}`,
    };
    const evidence = evidenceFor(next, step, metric);
    next.evidence.push(evidence);
    step.evidenceIds.push(evidence.id);
  } else if (step.id === "valuation" || step.id === "financial") {
    if (options.dataIssue) {
      step.dataIssue = options.dataIssue;
      log(next, "data_issue", `${step.title} 检测到${options.dataIssue === "missing" ? "数据缺失" : options.dataIssue === "stale" ? "数据过期" : "来源冲突"}；报告将列为待核验。`, step.id);
    }
  }

  if (step.id !== "scope" && step.id !== "synthesis" && step.dataIssue !== "missing") {
    for (const metric of metricsFor(step.id)) {
      const quality: EvidenceQuality = step.dataIssue === "stale" || step.dataIssue === "conflict" ? step.dataIssue : "ok";
      const evidence = evidenceFor(next, step, metric, quality);
      next.evidence.push(evidence);
      step.evidenceIds.push(evidence.id);
      if (step.dataIssue === "conflict") {
        const contrary: Evidence = {
          ...evidence,
          id: `${evidence.id}-conflicting-source`,
          source: "本地演示数据 · 第二来源冲突样本",
          rawValue: typeof metric.rawValue === "number" ? Number((metric.rawValue * 1.16).toFixed(2)) : `${metric.rawValue}（冲突）`,
          displayValue: "与第一来源不一致",
          requestId: `${evidence.requestId}-alternate`,
        };
        next.evidence.push(contrary);
        step.evidenceIds.push(contrary.id);
      }
    }
  }
  step.status = "completed";
  log(next, "step_completed", `${step.title} 已完成，新增 ${step.evidenceIds.length} 条演示证据。`, step.id);
  appendContext(next, step);
  if (!next.steps.some((candidate) => candidate.status === "pending" || candidate.status === "waiting_approval")) {
    next.status = "completed";
    next.report = makeReport(next);
    log(next, "report_created", "已生成事实、推断与未知分离的演示研究报告。", "synthesis");
    log(next, "run_completed", "研究计划已结束。", "synthesis");
  }
  return checkpoint(next);
}

export function approveRun(run: Run): Run {
  if (run.status !== "waiting_approval" || !run.approval) return run;
  const next = clone(run);
  const step = next.steps.find((item) => item.id === next.approval?.stepId);
  if (!step) return run;
  step.status = "pending";
  step.approved = true;
  next.approval!.decision = "approved";
  next.status = "running";
  log(next, "approval_granted", `${step.title} 已获用户确认。`, step.id);
  return checkpoint(next);
}

export function rejectRun(run: Run): Run {
  if (run.status !== "waiting_approval" || !run.approval) return run;
  const next = clone(run);
  const step = next.steps.find((item) => item.id === next.approval?.stepId);
  if (!step) return run;
  step.status = "skipped";
  next.approval!.decision = "rejected";
  next.status = "running";
  log(next, "approval_rejected", `${step.title} 被拒绝；报告会注明缺少财务证据。`, step.id);
  return checkpoint(next);
}

export function pauseRun(run: Run): Run {
  if (run.status !== "planned" && run.status !== "running" && run.status !== "waiting_approval") return run;
  const next = clone(run);
  next.pausedFrom = next.status;
  next.status = "paused";
  log(next, "run_paused", "用户暂停执行；检查点已保存。", next.approval?.stepId);
  return checkpoint(next);
}

export function resumeRun(run: Run): Run {
  if (run.status !== "paused" && run.status !== "planned") return run;
  const next = clone(run);
  next.status = next.pausedFrom === "waiting_approval" ? "waiting_approval" : "running";
  delete next.pausedFrom;
  log(next, "run_resumed", next.status === "waiting_approval" ? "已恢复，继续等待用户确认。" : "已从检查点恢复执行。", next.approval?.stepId);
  return checkpoint(next);
}

export function stopRun(run: Run): Run {
  if (run.status === "completed" || run.status === "stopped") return run;
  const next = clone(run);
  next.status = "stopped";
  next.stopReason = "用户主动停止";
  log(next, "run_stopped", next.stopReason);
  return checkpoint(next);
}

export function retryRun(run: Run): Run {
  if (run.status !== "failed") return run;
  const next = clone(run);
  const step = next.steps.find((item) => item.status === "failed");
  if (!step) return run;
  step.status = "pending";
  delete step.error;
  next.status = "running";
  log(next, "retry_scheduled", `${step.title} 已排入重试；之前完成的步骤不会重复执行。`, step.id);
  return checkpoint(next);
}

export function updateMemory(run: Run, text: string, kind: MemoryKind = "research_note", id?: string): Run {
  const value = text.trim();
  if (!value) return run;
  const next = clone(run);
  const existing = id ? next.memory.find((item) => item.id === id) : undefined;
  if (existing) {
    existing.text = value;
    existing.kind = kind;
    existing.updatedAt = clock(next.events.length);
    log(next, "memory_updated", `已更新长期记忆 ${existing.id}。`);
  } else {
    const record: MemoryRecord = {
      id: `${next.id}-memory-${next.events.length + 1}`,
      kind,
      text: value,
      updatedAt: clock(next.events.length),
      sourceRunId: next.id,
    };
    next.memory.push(record);
    log(next, "memory_added", `已保存长期记忆 ${record.id}。`);
  }
  return checkpoint(next);
}

export function deleteMemory(run: Run, id: string): Run {
  if (!run.memory.some((item) => item.id === id)) return run;
  const next = clone(run);
  next.memory = next.memory.filter((item) => item.id !== id);
  log(next, "memory_deleted", `已删除长期记忆 ${id}。`);
  return checkpoint(next);
}

/** JSON.parse(JSON.stringify(run)) is a complete checkpoint; this validates one before reuse. */
export function restoreRun(snapshot: string | Run): Run {
  const candidate: unknown = typeof snapshot === "string" ? JSON.parse(snapshot) : clone(snapshot);
  if (
    typeof candidate !== "object" || candidate === null ||
    (candidate as Run).mode !== "demo" ||
    !Array.isArray((candidate as Run).steps) ||
    !Array.isArray((candidate as Run).events) ||
    !Array.isArray((candidate as Run).evidence) ||
    !(candidate as Run).checkpoint ||
    ((candidate as Run).symbol !== DEMO_SYMBOL && (candidate as Run).status !== "stopped")
  ) {
    throw new Error("Invalid investment research checkpoint");
  }
  return candidate as Run;
}

export function makeReport(run: Run): Report {
  const clean = run.evidence.filter((item) => item.quality === "ok");
  const facts: ReportItem[] = clean.map((item) => ({
    text: `${item.label}：${item.displayValue}（${item.asOf}；${item.unit}；仅演示样本）`,
    evidenceIds: [item.id],
  }));
  const inferences: ReportItem[] = [];
  const valuation = clean.filter((item) => item.stepId === "valuation");
  const financial = clean.filter((item) => item.stepId === "financial");
  if (valuation.length && financial.length) {
    inferences.push({
      text: "演示样本同时提供估值和财务变化字段，可作为下一步核对可比公司、公告原文与统计口径的线索；不能据此推断未来涨跌。",
      evidenceIds: [...valuation, ...financial].map((item) => item.id),
    });
  }
  const unknowns: ReportItem[] = [
    { text: "真实行情、估值、财报公告原文及其最新状态尚未通过实际金融接口核验。", evidenceIds: [] },
  ];
  for (const step of run.steps) {
    if (step.dataIssue === "missing") unknowns.push({ text: `${step.title}：数据缺失，未填充正常数值。`, evidenceIds: [] });
    if (step.dataIssue === "stale") unknowns.push({ text: `${step.title}：样本时间过期，不纳入正常事实或推断。`, evidenceIds: step.evidenceIds });
    if (step.dataIssue === "conflict") unknowns.push({ text: `${step.title}：两个来源数值冲突，需回到原始字段核验。`, evidenceIds: step.evidenceIds });
    if (step.status === "skipped") unknowns.push({ text: `${step.title}：用户拒绝授权，未执行该步骤。`, evidenceIds: [] });
    if (step.status === "failed") unknowns.push({ text: `${step.title}：工具失败，数据未取得。`, evidenceIds: [] });
  }
  if (run.status === "stopped" && run.stopReason) unknowns.push({ text: run.stopReason, evidenceIds: [] });
  return {
    title: `${run.company} · 研究工作台演示报告`,
    summary: `本报告仅用于展示 Agent 工作流，所有数值均为本地合成数据，非实时金融信息。已收录 ${facts.length} 条演示事实；真实投资判断仍需核验原始来源。`,
    facts,
    inferences,
    unknowns,
    generatedAt: clock(run.events.length),
  };
}
