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
  assert.ok(run.report?.unknowns.some((item) => item.text.includes("用户拒绝授权")));
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
});
