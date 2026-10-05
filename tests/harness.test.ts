import assert from "node:assert/strict";
import test from "node:test";
import {
  TOOL_REGISTRY,
  advanceRun,
  approveRun,
  createRun,
  deleteMemory,
  makeReport,
  pauseRun,
  rejectRun,
  restoreRun,
  resumeRun,
  retryRun,
  stopRun,
  updateMemory,
  type Run,
  type ResearchFocus,
} from "../lib/harness";

const goal = "研究贵州茅台 600519.SH 的行情、估值与财务变化";

function throughValuation(): Run {
  let run = createRun(goal);
  run = advanceRun(run);
  run = advanceRun(run);
  run = advanceRun(run);
  return run;
}

function throughApproval(): Run {
  return advanceRun(throughValuation());
}

function completeFocus(focus: ResearchFocus): Run {
  let run = createRun(goal, { focus, id: `focus-${focus}` });
  run = advanceRun(run);
  run = advanceRun(run);
  run = advanceRun(run);
  run = approveRun(advanceRun(run));
  run = advanceRun(run);
  return advanceRun(run);
}

test("registers tools and creates a deterministic, clearly labelled demo plan", () => {
  const first = createRun(goal, { id: "test-deterministic" });
  const second = createRun(goal, { id: "test-deterministic" });
  assert.deepEqual(first, second);
  assert.notEqual(createRun(goal).id, createRun(goal).id);
  assert.equal(first.mode, "demo");
  assert.equal(first.status, "planned");
  assert.equal(first.steps.length, 5);
  assert.equal(first.steps[3].requiresApproval, true);
  assert.equal(TOOL_REGISTRY.length, 5);
  assert.ok(first.events.some((event) => event.type === "tools_registered"));
  assert.equal(resumeRun(first).status, "running");
});

test("defaults explicitly to 600519.SH and rejects unsupported stock codes", () => {
  const fallback = createRun("研究一家公司的财务表现");
  assert.equal(fallback.symbol, "600519.SH");
  assert.ok(fallback.events.some((event) => event.type === "default_symbol"));
  const unsupported = createRun("研究宁德时代 300750.SZ");
  assert.equal(unsupported.status, "stopped");
  assert.match(unsupported.stopReason || "", /仅支持 600519.SH/);
  assert.equal(advanceRun(unsupported), unsupported);
  assert.equal(unsupported.evidence.length, 0);
  const namedOther = createRun("研究宁德时代的估值");
  assert.equal(namedOther.status, "stopped");
  assert.equal(namedOther.symbol, "未支持标的");
  assert.equal(namedOther.events.some((event) => event.type === "default_symbol"), false);
  assert.equal(namedOther.evidence.length, 0);
});

test("advances one step at a time, asks approval at step four, and completes a cited report", () => {
  const preApproval = throughValuation();
  assert.deepEqual(preApproval.steps.map((step) => step.status), ["completed", "completed", "completed", "pending", "pending"]);
  assert.equal(preApproval.context.compactions, 1);
  const waiting = advanceRun(preApproval);
  assert.equal(waiting.status, "waiting_approval");
  assert.equal(waiting.steps[3].status, "waiting_approval");
  assert.equal(waiting.metrics.stepsExecuted, 3);
  assert.equal(advanceRun(waiting), waiting);
  let run = approveRun(waiting);
  assert.equal(run.status, "running");
  run = advanceRun(run);
  assert.equal(run.steps[3].status, "completed");
  run = advanceRun(run);
  assert.equal(run.status, "completed");
  assert.ok(run.report);
  assert.ok(run.report.facts.length >= 5);
  assert.ok(run.report.inferences.length > 0);
  assert.ok(run.report.unknowns.some((item) => item.text.includes("真实行情")));
  for (const evidence of run.evidence) {
    assert.equal(evidence.demo, true);
    assert.ok(evidence.source && evidence.asOf && evidence.unit && evidence.methodology && evidence.rawField && evidence.requestId);
  }
  assert.ok(run.report.facts.every((item) => item.evidenceIds.every((id) => run.evidence.some((evidence) => evidence.id === id))));
});

test("a rejected approval skips the sensitive step and surfaces the gap", () => {
  let run = rejectRun(throughApproval());
  assert.equal(run.steps[3].status, "skipped");
  run = advanceRun(run);
  assert.equal(run.status, "completed");
  assert.equal(run.evidence.some((item) => item.stepId === "financial"), false);
  assert.equal(run.report?.inferences.length, 0);
  assert.ok(run.report?.unknowns.some((item) => item.text.includes("用户选择跳过")));
});

test("failed tool can retry without rerunning completed steps", () => {
  let run = advanceRun(createRun(goal));
  const scopeEvidenceId = run.evidence[0].id;
  run = advanceRun(run, { failTool: "fuyao.quote", failureReason: "timeout" });
  assert.equal(run.status, "failed");
  assert.equal(run.steps[1].attempts, 1);
  assert.equal(run.steps[0].attempts, 1);
  run = retryRun(run);
  run = advanceRun(run);
  assert.equal(run.status, "running");
  assert.equal(run.steps[0].attempts, 1);
  assert.equal(run.steps[1].attempts, 2);
  assert.equal(run.evidence.filter((item) => item.id === scopeEvidenceId).length, 1);
  assert.ok(run.events.some((event) => event.type === "tool_failed"));
});

test("missing, stale, and conflicting data remain explicit unknowns", () => {
  for (const issue of ["missing", "stale", "conflict"] as const) {
    let run = advanceRun(createRun(goal));
    run = advanceRun(run);
    run = advanceRun(run, { dataIssue: issue });
    const report = makeReport(run);
    assert.ok(run.events.some((event) => event.type === "data_issue"));
    assert.ok(report.unknowns.some((item) => item.text.includes("估值")));
    assert.equal(report.facts.some((item) => item.text.includes("市盈率")), false);
    if (issue === "missing") assert.equal(run.evidence.some((item) => item.stepId === "valuation"), false);
    if (issue === "stale") assert.ok(run.evidence.some((item) => item.quality === "stale"));
    if (issue === "conflict") assert.ok(run.evidence.filter((item) => item.stepId === "valuation").length >= 4);
  }
});

test("pauses and restores a JSON checkpoint without duplicate success steps", () => {
  let run = advanceRun(createRun(goal));
  run = pauseRun(run);
  assert.equal(run.status, "paused");
  const restored = restoreRun(JSON.stringify(run));
  run = resumeRun(restored);
  assert.equal(run.status, "running");
  run = advanceRun(run);
  assert.equal(run.steps[0].attempts, 1);
  assert.equal(run.steps[1].attempts, 1);
  assert.deepEqual(run.checkpoint.completedStepIds, ["scope", "market"]);
  assert.throws(() => restoreRun("{}"), /Invalid/);
});

test("enforces step and cost limits, and supports user stop", () => {
  const bounded = createRun(goal, { limits: { maxSteps: 1 } });
  const afterOne = advanceRun(bounded);
  const stopped = advanceRun(afterOne);
  assert.equal(stopped.status, "stopped");
  assert.match(stopped.stopReason || "", /最大执行步数/);
  assert.equal(stopped.steps[1].status, "pending");
  const noBudget = createRun(goal, { limits: { maxCostUsd: 0 } });
  assert.equal(advanceRun(advanceRun(noBudget)).status, "stopped");
  assert.equal(stopRun(createRun(goal)).stopReason, "用户主动停止");
});

test("long term memory is editable, deletable, and reusable across runs", () => {
  let run = updateMemory(createRun(goal), "偏好展示原始字段", "preference");
  const id = run.memory[0].id;
  run = updateMemory(run, "偏好展示字段和统计口径", "preference", id);
  assert.equal(run.memory.length, 1);
  assert.match(run.memory[0].text, /统计口径/);
  const nextRun = createRun("复核贵州茅台 600519.SH", { memory: run.memory });
  assert.equal(nextRun.memory[0].text, run.memory[0].text);
  run = deleteMemory(run, id);
  assert.equal(run.memory.length, 0);
  const shared = updateMemory(run, "跨线程偏好", "preference", "shared-memory-id");
  assert.equal(shared.memory[0].id, "shared-memory-id");
});

test("research focus changes the five step descriptions and the cited answer", () => {
  const valuation = completeFocus("valuation");
  const performance = completeFocus("performance");
  const market = completeFocus("market");
  assert.deepEqual(valuation.steps.map((step) => step.id), performance.steps.map((step) => step.id));
  assert.deepEqual(valuation.steps.map((step) => step.id), market.steps.map((step) => step.id));
  assert.notEqual(valuation.steps[4].description, performance.steps[4].description);
  assert.notEqual(performance.steps[4].description, market.steps[4].description);
  assert.match(valuation.report!.answer.text, /当前估值是否合理或由业绩支撑/);
  assert.match(performance.report!.answer.text, /增速相差 1\.3 个百分点/);
  assert.match(market.report!.answer.text, /该日快照，不能解释波动原因/);
  for (const run of [valuation, performance, market]) {
    assert.equal(run.report!.nextChecks.length, 3);
    assert.ok(run.report!.answer.evidenceIds.length > 0);
    assert.ok(run.report!.answer.evidenceIds.every((id) => run.evidence.some((item) => item.id === id && item.quality === "ok")));
    assert.doesNotMatch(run.report!.answer.text, /买入|卖出|保证收益|必涨/);
  }
});

test("approval states the expanded demo scope, simulated cost and latency, and skip impact", () => {
  const waiting = advanceRun(throughValuation());
  assert.equal(waiting.status, "waiting_approval");
  const reason = waiting.approval?.reason || "";
  assert.match(reason, /扩大到财务数据/);
  assert.match(reason, /营业收入同比、归母净利润同比/);
  assert.match(reason, /\$0\.0024/);
  assert.match(reason, /620ms/);
  assert.match(reason, /跳过后/);
  assert.match(reason, /不会产生真实费用.*不涉及真实数据授权/);
});

test("focused answers never cite missing, stale, or conflicting evidence", () => {
  for (const issue of ["missing", "stale", "conflict"] as const) {
    let run = advanceRun(createRun(goal, { focus: "valuation", id: `issue-${issue}` }));
    run = advanceRun(run);
    run = advanceRun(run, { dataIssue: issue });
    run = approveRun(advanceRun(run));
    run = advanceRun(run);
    run = advanceRun(run);
    assert.ok(run.report!.unknowns.some((item) => item.text.includes("估值")));
    assert.ok(run.report!.answer.evidenceIds.every((id) => run.evidence.some((item) => item.id === id && item.quality === "ok")));
    assert.ok(run.report!.nextChecks.length > 0);
  }
});

test("legacy checkpoint gains a safe focus and report fields without repeating steps", () => {
  const finished = completeFocus("performance");
  const legacy = JSON.parse(JSON.stringify(finished)) as Record<string, unknown>;
  delete legacy.focus;
  const oldReport = legacy.report as Record<string, unknown>;
  delete oldReport.answer;
  delete oldReport.nextChecks;
  legacy.goal = "核对贵州茅台 600519.SH 营收与利润增速";
  const restored = restoreRun(JSON.stringify(legacy));
  assert.equal(restored.focus, "performance");
  assert.match(restored.steps[4].description, /增速差/);
  assert.ok(restored.report?.answer.text);
  assert.equal(restored.report?.nextChecks.length, 3);
  assert.deepEqual(restored.steps.map((step) => step.attempts), finished.steps.map((step) => step.attempts));
});

test("virtual latency limit stops before the next tool call", () => {
  const run = createRun(goal, { limits: { maxElapsedMs: 500 }, id: "time-limit" });
  const afterScope = advanceRun(run);
  const stopped = advanceRun(afterScope);
  assert.equal(stopped.status, "stopped");
  assert.match(stopped.stopReason || "", /运行时延上限/);
  assert.equal(stopped.metrics.elapsedMs, 130);
  assert.equal(stopped.steps[1].status, "pending");
  assert.ok(stopped.events.some((event) => event.type === "limit_reached"));
});

test("checkpoint restoration discards forged conclusions and event prose", () => {
  const completed = completeFocus("valuation");
  const forged = JSON.parse(JSON.stringify(completed)) as Run;
  forged.report!.answer.text = "保证收益，立即买入";
  forged.report!.facts.push({ text: "伪造的真实利润", evidenceIds: [] });
  forged.events[0].message = "真实行情验证成功，保证收益";
  const restored = restoreRun(JSON.stringify(forged));
  assert.equal(restored.status, "completed");
  assert.doesNotMatch(restored.report!.answer.text, /保证收益|买入/);
  assert.equal(restored.report!.facts.some((item) => item.text.includes("伪造")), false);
  assert.doesNotMatch(restored.events[0].message, /保证收益/);
  assert.deepEqual(restored.checkpoint.completedStepIds, completed.checkpoint.completedStepIds);
});

test("checkpoint restoration rejects malformed or forged evidence and state", () => {
  const completed = completeFocus("valuation");
  const badValue = JSON.parse(JSON.stringify(completed)) as Run;
  badValue.evidence[1].rawValue = 1;
  assert.throws(() => restoreRun(JSON.stringify(badValue)), /Invalid/);
  const badQuality = JSON.parse(JSON.stringify(completed)) as Run;
  badQuality.evidence[2].quality = "conflict";
  assert.throws(() => restoreRun(JSON.stringify(badQuality)), /Invalid/);
  const badSteps = JSON.parse(JSON.stringify(completed)) as Run;
  badSteps.steps = [];
  assert.throws(() => restoreRun(JSON.stringify(badSteps)), /Invalid/);
  const badMetrics = JSON.parse(JSON.stringify(completed)) as Run;
  badMetrics.metrics.estimatedUsd = -1;
  assert.throws(() => restoreRun(JSON.stringify(badMetrics)), /Invalid/);
  const inheritedEvent = JSON.parse(JSON.stringify(completed)) as Run;
  inheritedEvent.events[0].type = "toString";
  assert.throws(() => restoreRun(JSON.stringify(inheritedEvent)), /Invalid/);
  const prototypeEvent = JSON.parse(JSON.stringify(completed)) as Run;
  prototypeEvent.events[0].type = "__proto__";
  assert.throws(() => restoreRun(JSON.stringify(prototypeEvent)), /Invalid/);
});

test("checkpoint import cannot relabel a Maotai fixture as another company", () => {
  const original = completeFocus("valuation");
  const renamed = JSON.parse(JSON.stringify(original)) as Run;
  renamed.goal = "研究宁德时代的估值";
  assert.throws(() => restoreRun(JSON.stringify(renamed)), /Invalid/);
  const mixed = JSON.parse(JSON.stringify(original)) as Run;
  mixed.goal = "比较贵州茅台 600519.SH 与宁德时代 300750.SZ";
  assert.throws(() => restoreRun(JSON.stringify(mixed)), /Invalid/);
  const compatible = JSON.parse(JSON.stringify(original)) as Run;
  compatible.goal = "研究贵州茅台的当前估值与上半年业绩";
  assert.equal(restoreRun(JSON.stringify(compatible)).symbol, "600519.SH");
});

test("legitimate approval, failure, and stopped checkpoints remain resumable", () => {
  const waiting = throughApproval();
  assert.equal(restoreRun(JSON.stringify(waiting)).status, "waiting_approval");
  const pausedWaiting = pauseRun(waiting);
  assert.equal(resumeRun(restoreRun(JSON.stringify(pausedWaiting))).status, "waiting_approval");
  const stoppedWaiting = stopRun(waiting);
  assert.equal(restoreRun(JSON.stringify(stoppedWaiting)).status, "stopped");
  const failed = advanceRun(advanceRun(createRun(goal)), { failTool: "fuyao.quote" });
  const restoredFailed = restoreRun(JSON.stringify(failed));
  assert.equal(restoredFailed.status, "failed");
  assert.equal(retryRun(restoredFailed).steps[1].status, "pending");
});
