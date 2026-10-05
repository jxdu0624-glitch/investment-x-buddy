import assert from "node:assert/strict";
import test from "node:test";
import {
  executeFuyao,
  FuyaoAdapterError,
  fuyaoUrl,
  parseFuyaoEnvelope,
  parseFuyaoRequest,
} from "../lib/fuyao.ts";

test("quote parses a bounded list and fixes exchange-code casing", () => {
  const request = parseFuyaoRequest({
    tool: "quote",
    thscodes: [" 600519.sh ", "000001.sz", "600519.SH"],
  });
  assert.deepEqual(request, {
    tool: "quote",
    thscodes: ["600519.SH", "000001.SZ"],
  });
  const url = fuyaoUrl(request);
  assert.equal(url.pathname, "/api/a-share/prices/snapshot");
  assert.equal(url.searchParams.get("thscodes"), "600519.SH,000001.SZ");
});

test("historical validates dates and uses only the documented daily endpoint", () => {
  const request = parseFuyaoRequest({
    tool: "historical",
    thscode: "300033.SZ",
    start: Date.UTC(2025, 0, 1),
    end: Date.UTC(2025, 11, 31),
  }, Date.UTC(2026, 0, 1));
  assert.equal(fuyaoUrl(request).searchParams.get("interval"), "1d");
  assert.equal(fuyaoUrl(request).searchParams.get("adjust"), "forward");
  assert.throws(() => parseFuyaoRequest({
    tool: "historical",
    thscode: "300033.SZ",
    start: Date.UTC(2023, 0, 1),
    end: Date.UTC(2025, 0, 1),
  }, Date.UTC(2026, 0, 1)), FuyaoAdapterError);
});

test("financials routes statement types and rejects arbitrary paths", () => {
  const request = parseFuyaoRequest({
    tool: "financials",
    thscode: "600519.SH",
    statement: "cash-flow",
    period: "quarterly",
    limit: 8,
  });
  assert.equal(fuyaoUrl(request).pathname, "/api/a-share/financials/cash-flow-statements");
  assert.equal(fuyaoUrl(request).searchParams.get("limit"), "8");
  assert.throws(() => parseFuyaoRequest({
    tool: "financials", thscode: "600519.SH", statement: "../../admin",
  }), FuyaoAdapterError);
  assert.throws(() => parseFuyaoRequest({
    tool: "quote", thscode: "600519.SH", url: "https://example.com",
  }), FuyaoAdapterError);
});

test("upstream parser preserves code, request_id and explicit null", async () => {
  const envelope = {
    code: 3002,
    message: "数据尚未准备",
    request_id: "req-123",
    data: null,
  };
  assert.deepEqual(parseFuyaoEnvelope(envelope), envelope);
  assert.throws(() => parseFuyaoEnvelope({ ...envelope, data: undefined }), FuyaoAdapterError);
  assert.throws(() => parseFuyaoEnvelope({ ...envelope, request_id: 1 }), FuyaoAdapterError);

  const result = await executeFuyao(
    parseFuyaoRequest({ tool: "quote", thscode: "600519.SH" }),
    "private-test-key",
    {
      fetchImpl: async (url, init) => {
        assert.equal(new URL(url).host, "fuyao.aicubes.cn");
        assert.equal(init.headers["X-api-key"], "private-test-key");
        assert.equal(new URL(url).search.includes("private-test-key"), false);
        return Response.json(envelope);
      },
    },
  );
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, envelope);
});

test("no key fails closed and network errors do not expose exception text", async () => {
  const request = parseFuyaoRequest({ tool: "quote", thscode: "600519.SH" });
  await assert.rejects(executeFuyao(request, ""), (error) => {
    assert.equal(error.kind, "unavailable");
    assert.equal(error.status, 503);
    return true;
  });
  await assert.rejects(executeFuyao(request, "secret", {
    fetchImpl: async () => { throw new Error("secret detail"); },
  }), (error) => {
    assert.equal(error.kind, "network");
    assert.equal(error.message.includes("secret detail"), false);
    return true;
  });
});

test("timeout and malformed upstream responses return bounded diagnostic errors", async () => {
  const request = parseFuyaoRequest({ tool: "quote", thscode: "600519.SH" });
  await assert.rejects(executeFuyao(request, "secret", {
    timeoutMs: 5,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  }), (error) => {
    assert.equal(error.kind, "timeout");
    assert.equal(error.status, 504);
    return true;
  });

  await assert.rejects(executeFuyao(request, "secret", {
    fetchImpl: async () => Response.json({ code: 0, message: "success" }, {
      headers: { "x-request-id": "upstream-456" },
    }),
  }), (error) => {
    assert.equal(error.kind, "upstream_response");
    assert.equal(error.requestId, "upstream-456");
    return true;
  });
});
