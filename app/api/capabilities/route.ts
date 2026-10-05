import { FUYAO_LIMITS } from "@/lib/fuyao";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = Boolean(process.env.HITHINK_FINANCE_API_KEY?.trim());
  return Response.json(
    {
      fuyao: {
        configured,
        status: configured ? "ready" : "unavailable",
        tools: ["quote", "historical", "financials"],
        limits: FUYAO_LIMITS,
        documentation: "https://fuyao.aicubes.cn/docs/",
      },
      ifind: {
        configured: false,
        status: "not_connected",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
