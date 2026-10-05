import {
  adapterErrorBody,
  executeFuyao,
  FuyaoAdapterError,
  parseFuyaoRequest,
} from "@/lib/fuyao";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const key = process.env.HITHINK_FINANCE_API_KEY?.trim();
  if (!key) {
    const error = new FuyaoAdapterError("unavailable", "扶摇数据服务未配置。", 503);
    return Response.json(adapterErrorBody(error), { status: error.status, headers: NO_STORE });
  }

  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 4_096) {
      throw new FuyaoAdapterError("invalid_request", "请求体过大。", 413);
    }
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 4_096) {
      throw new FuyaoAdapterError("invalid_request", "请求体过大。", 413);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new FuyaoAdapterError("invalid_request", "请求体必须是有效 JSON。", 400);
    }

    const toolRequest = parseFuyaoRequest(payload);
    const result = await executeFuyao(toolRequest, key);
    const body = result.status === 200
      ? result.body
      : { ...result.body, error: { kind: "upstream_business" } };
    return Response.json(body, { status: result.status, headers: NO_STORE });
  } catch (error) {
    const safeError = error instanceof FuyaoAdapterError
      ? error
      : new FuyaoAdapterError("upstream_response", "服务端处理扶摇响应失败。", 502);
    return Response.json(adapterErrorBody(safeError), {
      status: safeError.status,
      headers: NO_STORE,
    });
  }
}
