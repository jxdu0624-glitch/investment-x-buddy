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
export type ResearchFocus = "valuation" | "performance" | "market";

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
  answer: ReportItem;
  facts: ReportItem[];
  inferences: ReportItem[];
  unknowns: ReportItem[];
  nextChecks: ReportItem[];
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
  focus: ResearchFocus;
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
  focus?: ResearchFocus;
}

export interface AdvanceOptions {
  failTool?: boolean | string;
  failureReason?: string;
  dataIssue?: DataIssue;
}

const BASE_TIME = Date.parse(DEMO_RETRIEVED_AT);
const DEFAULT_LIMITS: RunLimits = { maxSteps: 7, maxCostUsd: 0.03, maxElapsedMs: 6000 };
let fallbackRunCounter = 0;
const FOCUS_COPY: Record<ResearchFocus, { descriptions: Record<string, string>; approvalPurpose: string; skipImpact: string }> = {
  valuation: {
    descriptions: {
      scope: "确认 600519.SH 演示范围，聚焦当前估值与上半年业绩能说明什么",
      market: "记录单日演示价格，只作为估值观察的时点背景",
      valuation: "读取单时点 PE TTM 与三年分位摘要，不推断估值变化",
      financial: "经确认后读取上半年营收和归母净利润同比，用于并列观察",
      synthesis: "回答当前估值与业绩证据的边界，列出原始数据核查项",
    },
    approvalPurpose: "与单时点 PE TTM 并列观察，说明当前估值和上半年业绩各自能支持的判断",
    skipImpact: "无法对照估值和上半年业绩，报告会保留财务缺口",
  },
  performance: {
    descriptions: {
      scope: "确认 600519.SH 演示范围，聚焦上半年收入和利润增速差",
      market: "记录单日演示行情，避免将股价表现误当作业绩证据",
      valuation: "记录演示估值口径，避免与财务同比口径混淆",
      financial: "经确认后读取上半年营收与归母净利润同比，计算差值",
      synthesis: "回答增速差的数值和原因未知项，列出财报核查路径",
    },
    approvalPurpose: "比较上半年营业收入与归母净利润同比增速的差值",
    skipImpact: "无法计算收入和利润增速差，报告会保留业绩缺口",
  },
  market: {
    descriptions: {
      scope: "确认 600519.SH 演示范围，聚焦单日行情能说明什么",
      market: "读取单日演示收盘价与涨跌幅，只描述观察值",
      valuation: "记录同一时点的演示估值字段，不据此解释当日涨跌",
      financial: "经确认后补充上半年财务背景，不将其直接归因为单日波动",
      synthesis: "回答单日行情的可观察事实与无法归因的边界",
    },
    approvalPurpose: "补充上半年财务背景，并检验其与单日行情在时间口径上的差异",
    skipImpact: "报告仅有行情与估值演示字段，缺少财务背景",
  },
};
const STEP_DURATIONS: Record<string, number> = {
  scope: 130,
  market: 420,
  valuation: 470,
  financial: 620,
  synthesis: 560,
};
const SCOPE_METRIC: DemoMetric = {
  label: "研究标的代码",
  source: "用户目标解析 · 本地演示",
  asOf: "2026-10-05",
  unit: "证券代码",
  methodology: "仅将目标中的 600519.SH 解析为受支持的演示标的；未给代码时使用明确默认值",
  rawField: "goal.symbol",
  rawValue: DEMO_SYMBOL,
  displayValue: `${DEMO_COMPANY} · ${DEMO_SYMBOL}`,
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

function stockCodesIn(goal: string): string[] {
  return [...goal.matchAll(/(?:^|[^\d])(\d{6})(?:\.(?:SH|SZ|BJ))?(?!\d)/gi)].map((match) => match[1]);
}

function namesOtherCompany(goal: string): boolean {
  return /宁德时代|比亚迪|五粮液|中国平安|招商银行|东方财富|隆基绿能|中国中免|海康威视|中国石油|腾讯|阿里巴巴|美团/.test(goal);
}

function inferFocus(goal: string): ResearchFocus {
  if (/估值|市盈率|\bpe\b|高估|低估/i.test(goal)) return "valuation";
  if (/业绩|财报|营收|收入|利润|经营|增长|增速/.test(goal)) return "performance";
  if (/行情|股价|涨跌|波动|走势|市场/.test(goal)) return "market";
  return "valuation";
}

function isResearchFocus(value: unknown): value is ResearchFocus {
  return value === "valuation" || value === "performance" || value === "market";
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
  const conflictingTarget = stockCodesIn(cleanGoal).some((code) => code !== "600519") || namesOtherCompany(cleanGoal);
  const symbol = conflictingTarget && parsed.symbol === DEMO_SYMBOL ? "未支持标的" : parsed.symbol;
  const supported = symbol === DEMO_SYMBOL;
  const focus = isResearchFocus(options.focus) ? options.focus : inferFocus(cleanGoal);
  const descriptions = FOCUS_COPY[focus].descriptions;
  const uniquePart = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${++fallbackRunCounter}`;
  const run: Run = {
    id: options.id || `run-${hash(cleanGoal)}-${uniquePart}`,
    goal: cleanGoal,
    symbol,
    company: supported ? DEMO_COMPANY : "未支持标的",
    mode: "demo",
    focus,
    status: supported ? "planned" : "stopped",
    steps: [
      createStep("scope", "确认研究范围", descriptions.scope, "scope.parse"),
      createStep("market", "获取行情快照", descriptions.market, "fuyao.quote"),
      createStep("valuation", "观察估值", descriptions.valuation, "fuyao.valuation"),
      createStep("financial", "财务交叉验证", descriptions.financial, "fuyao.financial"),
      createStep("synthesis", "形成研究摘要", descriptions.synthesis, "research.synthesize"),
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
  log(run, "plan_created", `已生成五步可恢复研究计划；研究焦点：${focus === "valuation" ? "当前估值与业绩" : focus === "performance" ? "收入与利润表现" : "单日行情观察"}。`, "scope");
  if (!parsed.explicit && supported) {
    log(run, "default_symbol", "未检测到六位股票代码，明确采用贵州茅台 600519.SH 演示默认标的。", "scope");
  }
  if (!supported) {
    run.stopReason = conflictingTarget
      ? `当前演示数据仅支持 ${DEMO_SYMBOL}；目标含其他公司或股票代码，未执行，不能套用演示样本。`
      : `当前演示数据仅支持 ${DEMO_SYMBOL}；${parsed.symbol} 未执行，不能套用演示样本。`;
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

function approvalReason(focus: ResearchFocus, step: Step): string {
  const copy = FOCUS_COPY[focus];
  return `是否将本次研究范围扩大到财务数据？将读取本地演示的 2026 年上半年营业收入同比、归母净利润同比，用于${copy.approvalPurpose}。模拟增加成本 $${step.estimatedCostUsd.toFixed(4)} 和时延 ${STEP_DURATIONS[step.id]}ms；跳过后${copy.skipImpact}。实际不会产生真实费用，也不涉及真实数据授权。`;
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
      reason: approvalReason(next.focus || inferFocus(next.goal), step),
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
    const evidence = evidenceFor(next, step, SCOPE_METRIC);
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
  log(next, "approval_rejected", `用户选择跳过${step.title}；报告会注明缺少财务证据。`, step.id);
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
      id: id?.trim() || `${next.id}-memory-${next.events.length + 1}`,
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

function invalidCheckpoint(): never {
  throw new Error("Invalid investment research checkpoint");
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown, max = 4000): value is string {
  return typeof value === "string" && value.length <= max;
}

function countValue(value: unknown, max = 100000): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

function goalNamesOnlyDemoSymbol(goal: string): boolean {
  if (!/(?:^|[^\d])600519(?:\.SH)?(?!\d)/i.test(goal) && !goal.includes(DEMO_COMPANY)) return false;
  return stockCodesIn(goal).every((code) => code === "600519") && !namesOtherCompany(goal);
}

function amountValue(value: unknown, max = 100000): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
}

function expectedEvidence(run: Run, step: Step): Evidence[] {
  if (step.status !== "completed" || step.id === "synthesis" || step.dataIssue === "missing") return [];
  const quality: EvidenceQuality = step.dataIssue === "stale" || step.dataIssue === "conflict" ? step.dataIssue : "ok";
  const metrics = step.id === "scope" ? [SCOPE_METRIC] : metricsFor(step.id);
  const result: Evidence[] = [];
  for (const metric of metrics) {
    const evidence = evidenceFor(run, step, metric, quality);
    result.push(evidence);
    if (step.dataIssue === "conflict") {
      result.push({
        ...evidence,
        id: `${evidence.id}-conflicting-source`,
        source: "本地演示数据 · 第二来源冲突样本",
        rawValue: typeof metric.rawValue === "number" ? Number((metric.rawValue * 1.16).toFixed(2)) : `${metric.rawValue}（冲突）`,
        displayValue: "与第一来源不一致",
        requestId: `${evidence.requestId}-alternate`,
      });
    }
  }
  return result;
}

const RESTORED_EVENT_TEXT: Record<string, string> = {
  run_created: "演示研究线程已创建。",
  tools_registered: "演示工具已注册。",
  plan_created: "五步研究计划已生成。",
  default_symbol: "未给股票代码，使用 600519.SH 演示默认标的。",
  unsupported_symbol: "目标标的超出演示范围，运行已停止。",
  tool_called: "本地演示工具曾执行一次调用。",
  tool_failed: "本地演示工具调用曾失败。",
  data_issue: "演示数据存在质量问题，详情见对应步骤。",
  step_completed: "研究步骤已完成。",
  context_compacted: "上下文已压缩，证据仍单独保留。",
  approval_requested: "研究范围扩大到财务字段前，曾请求用户确认。",
  approval_granted: "用户曾确认扩大演示研究范围。",
  approval_rejected: "用户曾选择跳过财务演示字段。",
  report_created: "演示报告曾生成；恢复时已从证据重新构建。",
  run_completed: "演示研究流程已结束。",
  run_paused: "演示研究曾暂停。",
  run_resumed: "演示研究曾恢复。",
  run_stopped: "演示研究曾停止。",
  retry_scheduled: "失败步骤曾安排重试。",
  limit_reached: "演示执行曾触及停止规则。",
  memory_updated: "长期记忆曾更新。",
  memory_added: "长期记忆曾添加。",
  memory_deleted: "长期记忆曾删除。",
};

/** Restores only a known demo state. Imported prose and reports are never trusted. */
export function restoreRun(snapshot: string | Run): Run {
  if (typeof snapshot === "string" && snapshot.length > 1_000_000) invalidCheckpoint();
  const raw: unknown = typeof snapshot === "string" ? JSON.parse(snapshot) : clone(snapshot);
  if (!object(raw) || raw.mode !== "demo" || !textValue(raw.goal, 2000) || !textValue(raw.id, 128) ||
      !/^[a-zA-Z0-9_-]+$/.test(raw.id) || !object(raw.limits) || !Array.isArray(raw.steps) ||
      !Array.isArray(raw.evidence) || !Array.isArray(raw.events) || !object(raw.metrics) ||
      !object(raw.context) || !object(raw.checkpoint) || !Array.isArray(raw.memory)) invalidCheckpoint();
  const status = raw.status;
  if (status !== "planned" && status !== "running" && status !== "waiting_approval" &&
      status !== "paused" && status !== "completed" && status !== "failed" && status !== "stopped") invalidCheckpoint();
  const limits = raw.limits;
  if (!countValue(limits.maxSteps, 1000) || !amountValue(limits.maxCostUsd, 1000) || !countValue(limits.maxElapsedMs, 86_400_000)) invalidCheckpoint();
  const focus = isResearchFocus(raw.focus) ? raw.focus : inferFocus(raw.goal);
  if (raw.memory.length > 500 || raw.events.length > 5000) invalidCheckpoint();
  const memory: MemoryRecord[] = raw.memory.map((entry: unknown) => {
    if (!object(entry) || !textValue(entry.id, 256) || !textValue(entry.text, 2000) ||
        !textValue(entry.updatedAt, 80) || !textValue(entry.sourceRunId, 128) ||
        (entry.kind !== "preference" && entry.kind !== "research_note")) invalidCheckpoint();
    return { id: entry.id, kind: entry.kind, text: entry.text, updatedAt: entry.updatedAt, sourceRunId: entry.sourceRunId };
  });
  const restored = createRun(raw.goal, { id: raw.id, focus, limits: limits as unknown as RunLimits, memory });
  if (restored.symbol === DEMO_SYMBOL && !goalNamesOnlyDemoSymbol(raw.goal)) invalidCheckpoint();
  if (raw.symbol !== restored.symbol || raw.company !== restored.company ||
      (restored.symbol !== DEMO_SYMBOL && status !== "stopped") || raw.steps.length !== restored.steps.length) invalidCheckpoint();
  restored.status = status;
  for (let i = 0; i < restored.steps.length; i += 1) {
    const source = raw.steps[i];
    const target = restored.steps[i];
    if (!object(source) || source.id !== target.id || source.toolId !== target.toolId ||
        source.requiresApproval !== target.requiresApproval || source.estimatedCostUsd !== target.estimatedCostUsd ||
        !countValue(source.attempts, 1000) || !amountValue(source.elapsedMs, 86_400_000) ||
        source.elapsedMs !== source.attempts * STEP_DURATIONS[target.id] || !Array.isArray(source.evidenceIds) ||
        (source.status !== "pending" && source.status !== "waiting_approval" && source.status !== "completed" &&
         source.status !== "failed" && source.status !== "skipped") ||
        (source.dataIssue !== undefined && source.dataIssue !== "missing" && source.dataIssue !== "stale" && source.dataIssue !== "conflict") ||
        (source.dataIssue !== undefined && (target.id !== "valuation" && target.id !== "financial" || source.status !== "completed"))) invalidCheckpoint();
    target.status = source.status;
    target.attempts = source.attempts;
    target.elapsedMs = source.elapsedMs;
    if (source.dataIssue) target.dataIssue = source.dataIssue;
    if (source.approved === true) target.approved = true;
    else if (source.approved !== undefined && source.approved !== false) invalidCheckpoint();
    if (target.status === "failed") target.error = "演示工具调用失败或超时；可重试该步骤。";
    if (target.status === "completed" && target.attempts === 0) invalidCheckpoint();
    if (target.id === "financial" && target.status === "completed" && !target.approved) invalidCheckpoint();
    if (target.status === "waiting_approval" && target.id !== "financial") invalidCheckpoint();
    const expected = expectedEvidence(restored, target);
    if (source.evidenceIds.length !== expected.length ||
        source.evidenceIds.some((id: unknown, index: number) => id !== expected[index].id)) invalidCheckpoint();
    target.evidenceIds = expected.map((item) => item.id);
  }
  const expected = restored.steps.flatMap((step) => expectedEvidence(restored, step));
  if (raw.evidence.length !== expected.length) invalidCheckpoint();
  const fields: (keyof Evidence)[] = ["id", "stepId", "label", "source", "symbol", "asOf", "unit", "methodology", "rawField", "rawValue", "displayValue", "requestId", "quality", "demo"];
  restored.evidence = raw.evidence.map((entry: unknown, index: number) => {
    if (!object(entry) || !fields.every((field) => entry[field] === expected[index][field]) ||
        !textValue(entry.retrievedAt, 80) || Number.isNaN(Date.parse(entry.retrievedAt))) invalidCheckpoint();
    return { ...expected[index], retrievedAt: entry.retrievedAt };
  });
  const expectedCalls = restored.steps.reduce((sum, step) => sum + step.attempts, 0);
  const expectedCost = Number(restored.steps.reduce((sum, step) => sum + step.attempts * step.estimatedCostUsd, 0).toFixed(4));
  const expectedElapsed = restored.steps.reduce((sum, step) => sum + step.elapsedMs, 0);
  if (raw.metrics.toolCalls !== expectedCalls || raw.metrics.stepsExecuted !== expectedCalls ||
      raw.metrics.estimatedUsd !== expectedCost || raw.metrics.elapsedMs !== expectedElapsed) invalidCheckpoint();
  restored.metrics = { toolCalls: expectedCalls, stepsExecuted: expectedCalls, estimatedUsd: expectedCost, elapsedMs: expectedElapsed };
  if (!countValue(raw.context.compactions, 1000) || !amountValue(raw.context.tokenEstimate, 100000) ||
      !textValue(raw.context.summary, 100000) || !Array.isArray(raw.context.recent) ||
      raw.context.recent.length > 100 || !raw.context.recent.every((item: unknown) => textValue(item, 4000))) invalidCheckpoint();
  restored.context = {
    compactions: raw.context.compactions,
    tokenEstimate: raw.context.tokenEstimate,
    recent: [],
    summary: raw.context.compactions ? `已完成：${restored.steps.filter((step) => step.status === "completed").map((step) => step.title).join("、") || "无"}。保留证据引用：${restored.evidence.map((item) => item.id).join("、") || "无"}。原始证据保存在证据清单中。` : "",
  };
  restored.events = raw.events.map((entry: unknown, index: number) => {
    if (!object(entry) || !textValue(entry.type, 60) || !Object.hasOwn(RESTORED_EVENT_TEXT, entry.type) ||
        !textValue(entry.message, 4000) || !textValue(entry.at, 80) ||
        (entry.stepId !== undefined && !restored.steps.some((step) => step.id === entry.stepId))) invalidCheckpoint();
    return {
      id: `${restored.id}-event-${index + 1}`,
      type: entry.type,
      message: RESTORED_EVENT_TEXT[entry.type] || "检查点中的历史事件已保留类型；原始文案未验真。",
      at: clock(index),
      ...(typeof entry.stepId === "string" ? { stepId: entry.stepId } : {}),
    };
  });
  if (!countValue(raw.checkpoint.revision, 100000) || !Array.isArray(raw.checkpoint.completedStepIds) ||
      raw.checkpoint.completedStepIds.length !== restored.steps.filter((step) => step.status === "completed").length ||
      raw.checkpoint.completedStepIds.some((id: unknown, index: number) => id !== restored.steps.filter((step) => step.status === "completed")[index].id)) invalidCheckpoint();
  restored.checkpoint = { revision: raw.checkpoint.revision, savedAt: clock(restored.events.length), completedStepIds: restored.steps.filter((step) => step.status === "completed").map((step) => step.id) };
  const financial = restored.steps[3];
  if (financial.status === "waiting_approval" || financial.approved || financial.status === "skipped") {
    restored.approval = {
      stepId: "financial",
      reason: approvalReason(focus, financial),
      ...(financial.status === "skipped" ? { decision: "rejected" as const } : financial.approved ? { decision: "approved" as const } : {}),
    };
  }
  if (status === "paused") {
    if (raw.pausedFrom !== "planned" && raw.pausedFrom !== "running" && raw.pausedFrom !== "waiting_approval") invalidCheckpoint();
    restored.pausedFrom = raw.pausedFrom;
  }
  if (status !== "stopped" && (status === "waiting_approval" || restored.pausedFrom === "waiting_approval") !== (financial.status === "waiting_approval")) invalidCheckpoint();
  if (status === "failed" && restored.steps.filter((step) => step.status === "failed").length !== 1) invalidCheckpoint();
  if (status === "completed" && (restored.steps[4].status !== "completed" || restored.steps.some((step) => step.status !== "completed" && step.status !== "skipped"))) invalidCheckpoint();
  if (status === "planned" && restored.steps.some((step) => step.status !== "pending")) invalidCheckpoint();
  if (status === "running" && !restored.steps.some((step) => step.status === "pending")) invalidCheckpoint();
  if (status === "stopped") {
    const allowed = ["用户主动停止", "已达到最大执行步数", "已达到成本预算上限", "已达到运行时延上限", restored.stopReason];
    restored.stopReason = allowed.includes(raw.stopReason as string) ? raw.stopReason as string : "本次研究已停止；导入的停止说明未验真。";
  }
  if (status === "completed") restored.report = makeReport(restored);
  return restored;
}

export function makeReport(run: Run): Report {
  const focus = isResearchFocus(run.focus) ? run.focus : inferFocus(run.goal);
  const clean = run.evidence.filter((item) => item.quality === "ok");
  const facts: ReportItem[] = clean.map((item) => ({
    text: `${item.label}：${item.displayValue}（${item.asOf}；${item.unit}；仅演示样本）`,
    evidenceIds: [item.id],
  }));
  const inferences: ReportItem[] = [];
  const valuation = clean.filter((item) => item.stepId === "valuation");
  const financial = clean.filter((item) => item.stepId === "financial");
  const market = clean.filter((item) => item.stepId === "market");
  const pe = valuation.find((item) => item.rawField === "valuation.pe_ttm");
  const revenue = financial.find((item) => item.rawField === "financial.revenue_yoy_h1");
  const profit = financial.find((item) => item.rawField === "financial.net_profit_yoy_h1");
  const close = market.find((item) => item.rawField === "daily.close");
  const change = market.find((item) => item.rawField === "daily.pct_change");
  const valuationIds = valuation.map((item) => item.id);
  const financialIds = financial.map((item) => item.id);
  const marketIds = market.map((item) => item.id);
  let answer: ReportItem;
  let nextChecks: ReportItem[];

  if (focus === "valuation") {
    const cited = [pe, revenue, profit].filter((item): item is Evidence => Boolean(item));
    if (pe && revenue && profit) {
      answer = {
        text: `演示样本显示单时点 PE TTM ${pe.displayValue}、上半年营收同比 ${revenue.displayValue}、归母净利润同比 ${profit.displayValue}；这些不同期间和口径的字段只能并列观察，不足以判断当前估值是否合理或由业绩支撑。`,
        evidenceIds: cited.map((item) => item.id),
      };
      inferences.push({
        text: "单时点估值与半年度同比之间没有足够的时间序列和可比口径，不能建立业绩对当前估值的解释关系。",
        evidenceIds: cited.map((item) => item.id),
      });
    } else if (pe) {
      answer = { text: `目前仅有单时点 PE TTM ${pe.displayValue} 的可用演示证据；缺少可用财务对照，无法回答当前估值与上半年业绩的关系。`, evidenceIds: [pe.id] };
    } else if (revenue || profit) {
      answer = { text: "目前仅有部分上半年业绩演示字段，没有可用的单时点估值证据，无法回答当前估值与业绩的关系。", evidenceIds: cited.map((item) => item.id) };
    } else {
      answer = { text: "缺少可用的估值与财务演示证据，无法回答当前估值与上半年业绩的问题。", evidenceIds: [] };
    }
    nextChecks = [
      { text: "从实际金融接口获取连续 PE TTM、股价及对应交易日，核对复权和近四季利润口径。", evidenceIds: valuationIds },
      { text: "核对公司上半年公告原文中的收入、归母净利润、基期数与披露日期。", evidenceIds: financialIds },
      { text: "选取业务与会计口径可比的公司，检查估值分位样本区间是否一致。", evidenceIds: valuationIds },
    ];
  } else if (focus === "performance") {
    if (revenue && profit && typeof revenue.rawValue === "number" && typeof profit.rawValue === "number") {
      const gap = Math.abs(revenue.rawValue - profit.rawValue).toFixed(1);
      answer = {
        text: `演示样本显示上半年营收同比 ${revenue.displayValue}、归母净利润同比 ${profit.displayValue}，增速相差 ${gap} 个百分点；现有字段不能解释差距的原因。`,
        evidenceIds: [revenue.id, profit.id],
      };
      inferences.push({
        text: `收入与归母净利润同比增速相差 ${gap} 个百分点；需要费用、毛利率和非经常性损益等明细才能分析原因。`,
        evidenceIds: [revenue.id, profit.id],
      });
    } else {
      answer = { text: "没有同时取得可用的营收与归母净利润同比字段，无法计算上半年增速差。", evidenceIds: [revenue, profit].filter((item): item is Evidence => Boolean(item)).map((item) => item.id) };
    }
    nextChecks = [
      { text: "对照公司公告原文复算上半年营收和归母净利润同比，核对基期及合并范围。", evidenceIds: financialIds },
      { text: "拆解毛利率、期间费用、税费和非经常性损益，核查增速差的可能来源。", evidenceIds: financialIds },
      { text: "核查经营现金流与利润匹配程度，并对照上一期同口径变化。", evidenceIds: financialIds },
    ];
  } else {
    if (close && change) {
      answer = {
        text: `演示单日收盘价为 ${close.displayValue}、当日涨跌幅 ${change.displayValue}；这只能描述该日快照，不能解释波动原因或推断后续走势。`,
        evidenceIds: [close.id, change.id],
      };
      inferences.push({ text: "单日价格与涨跌幅缺少连续行情和事件对照，无法作出波动归因。", evidenceIds: [close.id, change.id] });
    } else {
      answer = { text: "没有取得完整的单日行情演示快照，无法描述当日价格变化。", evidenceIds: [close, change].filter((item): item is Evidence => Boolean(item)).map((item) => item.id) };
    }
    nextChecks = [
      { text: "从真实行情接口补齐近 20 个交易日的价格、成交量及复权口径。", evidenceIds: marketIds },
      { text: "对齐同日指数、板块和资金数据的时间窗口，检查是否有共同波动。", evidenceIds: marketIds },
      { text: "核对公告、政策和新闻原文及发布时间，再评估是否存在可验证的事件关联。", evidenceIds: [] },
    ];
  }
  const unknowns: ReportItem[] = [
    { text: "真实行情、估值、财报公告原文及其最新状态尚未通过实际金融接口核验。", evidenceIds: [] },
  ];
  if (focus === "valuation") unknowns.push({ text: "缺少完整历史 PE / 价格序列、可比公司及财报原文，不能判断估值变化、合理性或驱动因素。", evidenceIds: valuationIds });
  if (focus === "performance") unknowns.push({ text: "缺少毛利率、费用、非经常性损益与现金流明细，不能解释收入和利润增速差的原因。", evidenceIds: financialIds });
  if (focus === "market") unknowns.push({ text: "缺少连续行情、成交量、板块和事件时间线，单日变化无法归因。", evidenceIds: marketIds });
  for (const step of run.steps) {
    if (step.dataIssue === "missing") unknowns.push({ text: `${step.title}：数据缺失，未填充正常数值。`, evidenceIds: [] });
    if (step.dataIssue === "stale") unknowns.push({ text: `${step.title}：样本时间过期，不纳入正常事实或推断。`, evidenceIds: step.evidenceIds });
    if (step.dataIssue === "conflict") unknowns.push({ text: `${step.title}：两个来源数值冲突，需回到原始字段核验。`, evidenceIds: step.evidenceIds });
    if (step.status === "skipped") unknowns.push({ text: `${step.title}：用户选择跳过，未执行该步骤。`, evidenceIds: [] });
    if (step.status === "failed") unknowns.push({ text: `${step.title}：工具失败，数据未取得。`, evidenceIds: [] });
  }
  if (run.status === "stopped" && run.stopReason) unknowns.push({ text: run.stopReason, evidenceIds: [] });
  return {
    title: `${run.company} · ${focus === "valuation" ? "当前估值与上半年业绩" : focus === "performance" ? "上半年业绩观察" : "单日行情观察"}演示报告`,
    summary: `本报告仅用于展示 Agent 工作流，所有数值均为本地合成数据，非实时金融信息。已收录 ${facts.length} 条演示事实；真实投资判断仍需核验原始来源。`,
    answer,
    facts,
    inferences,
    unknowns,
    nextChecks,
    generatedAt: clock(run.events.length),
  };
}
