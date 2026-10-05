/** A bounded server-side adapter for the public Fuyao REST API. */

export const FUYAO_BASE_URL = "https://fuyao.aicubes.cn";
export const FUYAO_TIMEOUT_MS = 8_000;
export const FUYAO_LIMITS = {
  quoteSymbols: 5,
  historicalDays: 400,
  financialPeriods: 8,
} as const;

type QuoteRequest = { tool: "quote"; thscodes: string[] };
type HistoricalRequest = {
  tool: "historical";
  thscode: string;
  start: number;
  end: number;
  adjust: "none" | "forward" | "backward";
};
type FinancialsRequest = {
  tool: "financials";
  thscode: string;
  statement: "income" | "balance" | "cash-flow";
  period: "annual" | "quarterly";
  limit: number;
};

export type FuyaoToolRequest = QuoteRequest | HistoricalRequest | FinancialsRequest;

export type FuyaoEnvelope = {
  code: number;
  message: string;
  request_id: string | null;
  data: unknown;
};

export type FuyaoErrorKind =
  | "invalid_request"
  | "unavailable"
  | "timeout"
  | "network"
  | "upstream_http"
  | "upstream_response";

export class FuyaoAdapterError extends Error {
  readonly kind: FuyaoErrorKind;
  readonly status: number;
  readonly requestId: string | null;

  constructor(
    kind: FuyaoErrorKind,
    message: string,
    status: number,
    requestId: string | null = null,
  ) {
    super(message);
    this.name = "FuyaoAdapterError";
    this.kind = kind;
    this.status = status;
    this.requestId = requestId;
  }
}

function invalid(message: string): never {
  throw new FuyaoAdapterError("invalid_request", message, 400);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("请求体必须是 JSON 对象。 ");
  }
  return value as Record<string, unknown>;
}

function requireCode(value: unknown): string {
  if (typeof value !== "string") invalid("thscode 必须是带交易所后缀的字符串。 ");
  const code = value.trim().toUpperCase();
  if (!/^\d{6}\.(SH|SZ|BJ)$/.test(code)) {
    invalid("thscode 格式应为 600519.SH、000001.SZ 或 920002.BJ。 ");
  }
  return code;
}

function requireInt(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    invalid(`${name} 必须是整数。 `);
  }
  return value;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) invalid(`不支持参数 ${extra}。 `);
}

/** Validate an untrusted client payload before it can select an upstream path. */
export function parseFuyaoRequest(input: unknown, nowMs = Date.now()): FuyaoToolRequest {
  const body = record(input);

  if (body.tool === "quote") {
    onlyKeys(body, ["tool", "thscode", "thscodes"]);
    if (body.thscode !== undefined && body.thscodes !== undefined) {
      invalid("thscode 与 thscodes 只能传其中一个。 ");
    }
    const raw = body.thscodes ?? body.thscode;
    const codes = Array.isArray(raw) ? raw : [raw];
    if (codes.length === 0 || codes.length > FUYAO_LIMITS.quoteSymbols) {
      invalid(`行情快照最多查询 ${FUYAO_LIMITS.quoteSymbols} 只 A 股。 `);
    }
    const thscodes = [...new Set(codes.map(requireCode))];
    return { tool: "quote", thscodes };
  }

  if (body.tool === "historical") {
    onlyKeys(body, ["tool", "thscode", "start", "end", "adjust"]);
    const thscode = requireCode(body.thscode);
    const start = requireInt(body.start, "start");
    const end = requireInt(body.end, "end");
    const minMs = Date.UTC(1990, 0, 1);
    if (start < minMs || end < start || end > nowMs + 86_400_000) {
      invalid("历史行情时间范围无效。 ");
    }
    if (end - start > FUYAO_LIMITS.historicalDays * 86_400_000) {
      invalid(`历史行情窗口不能超过 ${FUYAO_LIMITS.historicalDays} 天。 `);
    }
    const adjust = body.adjust ?? "forward";
    if (adjust !== "none" && adjust !== "forward" && adjust !== "backward") {
      invalid("adjust 仅支持 none、forward 或 backward。 ");
    }
    return { tool: "historical", thscode, start, end, adjust };
  }

  if (body.tool === "financials") {
    onlyKeys(body, ["tool", "thscode", "statement", "period", "limit"]);
    const thscode = requireCode(body.thscode);
    const statement = body.statement;
    if (statement !== "income" && statement !== "balance" && statement !== "cash-flow") {
      invalid("statement 仅支持 income、balance 或 cash-flow。 ");
    }
    const period = body.period ?? "annual";
    if (period !== "annual" && period !== "quarterly") {
      invalid("period 仅支持 annual 或 quarterly。 ");
    }
    const limit = requireInt(body.limit ?? 4, "limit");
    if (limit < 1 || limit > FUYAO_LIMITS.financialPeriods) {
      invalid(`财务报表最多查询 ${FUYAO_LIMITS.financialPeriods} 期。 `);
    }
    return { tool: "financials", thscode, statement, period, limit };
  }

  return invalid("tool 仅支持 quote、historical 或 financials。 ");
}

export function fuyaoUrl(request: FuyaoToolRequest): URL {
  let path: string;
  const params = new URLSearchParams();
  if (request.tool === "quote") {
    path = "/api/a-share/prices/snapshot";
    params.set("thscodes", request.thscodes.join(","));
  } else if (request.tool === "historical") {
    path = "/api/a-share/prices/historical";
    params.set("thscode", request.thscode);
    params.set("interval", "1d");
    params.set("start", String(request.start));
    params.set("end", String(request.end));
    params.set("adjust", request.adjust);
  } else {
    const statementPath = {
      income: "income-statements",
      balance: "balance-sheets",
      "cash-flow": "cash-flow-statements",
    }[request.statement];
    path = `/api/a-share/financials/${statementPath}`;
    params.set("thscode", request.thscode);
    params.set("period", request.period);
    params.set("limit", String(request.limit));
  }
  return new URL(`${path}?${params}`, FUYAO_BASE_URL);
}

export function parseFuyaoEnvelope(input: unknown): FuyaoEnvelope {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new FuyaoAdapterError("upstream_response", "扶摇返回了无效响应。 ", 502);
  }
  const body = input as Record<string, unknown>;
  if (
    typeof body.code !== "number" ||
    !Number.isInteger(body.code) ||
    typeof body.message !== "string" ||
    !(typeof body.request_id === "string" || body.request_id === null) ||
    !("data" in body) ||
    body.data === undefined
  ) {
    throw new FuyaoAdapterError("upstream_response", "扶摇返回了无效响应。 ", 502);
  }
  return body as FuyaoEnvelope;
}

export function upstreamStatus(code: number): number {
  if (code === 0) return 200;
  if (code >= 1000 && code < 2000) return 400;
  if (code === 2001 || code === 2003 || code === 3002) return 503;
  if (code === 3001) return 404;
  if (code === 4001) return 429;
  return 502;
}

export async function executeFuyao(
  request: FuyaoToolRequest,
  key: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ status: number; body: FuyaoEnvelope }> {
  if (!key.trim()) {
    throw new FuyaoAdapterError("unavailable", "扶摇数据服务未配置。 ", 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? FUYAO_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(fuyaoUrl(request), {
      method: "GET",
      headers: { "X-api-key": key, Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const upstreamRequestId = response.headers.get("x-request-id");
    if (!response.ok) {
      throw new FuyaoAdapterError(
        "upstream_http",
        "扶摇数据服务返回 HTTP 错误。",
        response.status === 429 ? 429 : 502,
        upstreamRequestId,
      );
    }

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      if (controller.signal.aborted) {
        throw new FuyaoAdapterError("timeout", "扶摇数据请求超时。", 504, upstreamRequestId);
      }
      throw new FuyaoAdapterError("upstream_response", "扶摇返回了无效 JSON。", 502, upstreamRequestId);
    }
    try {
      const body = parseFuyaoEnvelope(raw);
      return { status: upstreamStatus(body.code), body };
    } catch (error) {
      if (error instanceof FuyaoAdapterError) {
        throw new FuyaoAdapterError(error.kind, error.message, error.status, upstreamRequestId);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof FuyaoAdapterError) throw error;
    const timedOut = controller.signal.aborted;
    throw new FuyaoAdapterError(
      timedOut ? "timeout" : "network",
      timedOut ? "扶摇数据请求超时。" : "扶摇数据服务连接失败。",
      timedOut ? 504 : 502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function adapterErrorBody(error: FuyaoAdapterError) {
  return {
    code: error.kind.toUpperCase(),
    message: error.message.trim(),
    request_id: error.requestId,
    data: null,
    error: { kind: error.kind },
  };
}
