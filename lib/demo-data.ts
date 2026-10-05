/**
 * Deterministic, entirely synthetic values for the 600519.SH product demo.
 * These are deliberately not fetched market data and must never be presented
 * as an actual quote, filing, or investment conclusion.
 */
export const DEMO_SYMBOL = "600519.SH";
export const DEMO_COMPANY = "贵州茅台";
export const DEMO_RETRIEVED_AT = "2026-10-05T08:00:00.000Z";

export interface DemoMetric {
  label: string;
  source: string;
  asOf: string;
  unit: string;
  methodology: string;
  rawField: string;
  rawValue: string | number;
  displayValue: string;
}

export const DEMO_MARKET_METRICS: DemoMetric[] = [
  {
    label: "演示收盘价",
    source: "本地演示数据 · 扶摇行情字段结构",
    asOf: "2026-09-30",
    unit: "元/股",
    methodology: "演示用日线收盘字段；非真实交易所行情",
    rawField: "daily.close",
    rawValue: 1488.6,
    displayValue: "¥1,488.60",
  },
  {
    label: "演示当日涨跌幅",
    source: "本地演示数据 · 扶摇行情字段结构",
    asOf: "2026-09-30",
    unit: "%",
    methodology: "(演示收盘价 / 演示前收盘价 - 1) × 100；非真实行情",
    rawField: "daily.pct_change",
    rawValue: -0.42,
    displayValue: "−0.42%",
  },
];

export const DEMO_VALUATION_METRICS: DemoMetric[] = [
  {
    label: "演示市盈率 TTM",
    source: "本地演示数据 · 扶摇估值字段结构",
    asOf: "2026-09-30",
    unit: "倍",
    methodology: "演示市值 / 演示近四季归母净利润；样本数据未核验",
    rawField: "valuation.pe_ttm",
    rawValue: 25.8,
    displayValue: "25.8 倍",
  },
  {
    label: "演示三年估值分位",
    source: "本地演示数据 · 扶摇估值字段结构",
    asOf: "2026-09-30",
    unit: "%",
    methodology: "演示 PE TTM 在演示三年样本中的经验分位；非真实统计",
    rawField: "valuation.pe_ttm_percentile_3y",
    rawValue: 61,
    displayValue: "61%",
  },
];

export const DEMO_FINANCIAL_METRICS: DemoMetric[] = [
  {
    label: "演示营业收入同比",
    source: "本地演示数据 · 财报字段结构",
    asOf: "2026-06-30",
    unit: "%",
    methodology: "演示 2026 上半年营收相对演示上年同期变动；未核对公告原文",
    rawField: "financial.revenue_yoy_h1",
    rawValue: 7.4,
    displayValue: "+7.4%",
  },
  {
    label: "演示归母净利润同比",
    source: "本地演示数据 · 财报字段结构",
    asOf: "2026-06-30",
    unit: "%",
    methodology: "演示 2026 上半年归母净利润相对演示上年同期变动；未核对公告原文",
    rawField: "financial.net_profit_yoy_h1",
    rawValue: 6.1,
    displayValue: "+6.1%",
  },
];
