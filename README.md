# 投资 X Buddy

面向投资研究者的个人 Agent 工作台。用户输入研究目标后，可以查看五步研究计划、逐步执行工具、在财务交叉验证前作出审批决定，并从证据卡片回到原始字段。工作台展示任务、事件、上下文摘要、记忆、检查点、成本和时延预算，以及事实、推断、待核验信息分开的研究产物。

> **当前产品是演示模式。** 研究主链路只使用仓库内的合成样本，不调用真实行情，不生成真实投资结论。另提供独立的扶摇 REST 服务端适配 API；即使配置了 API Key，演示研究线程也不会自动切换为真实数据。公开部署时请保持这个标识清晰。

## 交付入口

| 项目 | 地址或状态 |
| --- | --- |
| 公开可访问 Web 产品 | [投资 X Buddy](https://investment-x-buddy-djx.dujiaxin0624.chatgpt.site) |
| 源代码仓库（Sites Git 远端） | [Sites Git 源码仓库](https://git.chatgpt-team.site/5aef0e86-60f1-4cd3-bfdc-d99cc114b4e4/appgprj_6ac3794c1f9881919fa489f5cd5369e3.git)（匿名读取权限待确认） |
| AI 使用与验证记录 | [AI_USAGE_AND_VALIDATION.md](./AI_USAGE_AND_VALIDATION.md) |
| 测试说明 | [TESTING.md](./TESTING.md) |
| 题目原文 | [13_投资XBuddy.md](./docs/13_投资XBuddy.md) |

发布后应在无站点登录态的浏览器中实际打开公开部署站点检查主链路。源码仓库由 Sites 托管，若评审需要匿名读取源码，需另行镜像至公开 Git 服务。

## 快速启动

环境：Node.js `>=22.13.0`。项目使用 React 19、Next 16 API、Vinext/Vite 和 TypeScript。依赖锁定在 `package-lock.json`。

```bash
cd investment-x-buddy
npm ci
npm run dev
```

打开终端显示的本地地址；便携本地配置通常从 `http://localhost:5173` 启动。未设置任何密钥即可完整体验合成数据研究流程。构建与本地 Worker 预览：

```bash
npm run build
npm start
```

`npm start` 预览已构建的 Worker，端口以终端输出为准。项目通过 Codex Sites 发布时，应按照该托管环境的发布流程部署构建产物，并将服务端密钥放进托管平台的 secret 配置；不要把 `.env.local` 或任何 API Key 提交到源码仓库。

### 可选的扶摇服务端配置

复制 `.env.example` 为 `.env.local`，仅在**服务端**填写自己签发、具有相应权限的 `HITHINK_FINANCE_API_KEY`。扶摇官方[快速开始](https://fuyao.aicubes.cn/docs/quickstart/)说明该密钥通过 `X-api-key` 请求头鉴权。浏览器不直接持有密钥；本项目也未设置 `NEXT_PUBLIC_` 金融密钥。服务端环境变量是否就绪可通过 `GET /api/capabilities` 查看，该接口只返回布尔状态和受限工具清单，不返回密钥。

`POST /api/fuyao` 是一个有界的服务端代理，当前允许三类请求：

| `tool` | 扶摇 REST 端点 | 本地限制 |
| --- | --- | --- |
| `quote` | `GET /api/a-share/prices/snapshot` | 每次至多 5 只股票 |
| `historical` | `GET /api/a-share/prices/historical` | 日线；窗口至多 400 天 |
| `financials` | `GET /api/a-share/financials/{income-statements,balance-sheets,cash-flow-statements}` | 最近至多 8 期 |

请求只接受白名单字段、标准化的 A 股 `thscode`、受限日期和报表类型。上游 URL 固定，超时 8 秒；缺少密钥、网络/超时、异常信封、上游业务 `code` 均返回明确错误，不以演示数值填补。请求体上限 4 KiB，响应不缓存。扶摇本身使用含 `code`、`message`、`request_id`、`data` 的统一响应信封；其业务错误不应仅凭 HTTP 200 判为成功。接口契约参见扶摇官方仓库的[行情](https://github.com/HiThink-Tech/Financial-API/blob/main/docs/api/a-share/prices.md)、[财务报表](https://github.com/HiThink-Tech/Financial-API/blob/main/docs/api/a-share/financials.md)和[API 总览](https://github.com/HiThink-Tech/Financial-API/blob/main/docs/api/README.md)。

示例（需要有效服务端密钥；不应把密钥写入命令行或浏览器）：

```bash
curl -s http://localhost:5173/api/capabilities
curl -s http://localhost:5173/api/fuyao \
  -H 'Content-Type: application/json' \
  -d '{"tool":"quote","thscode":"600519.SH"}'
```

**现阶段未连接 iFinD MCP。** `GET /api/capabilities` 将其标为 `not_connected`。系统也没有将扶摇服务端返回值并入演示报告、建立实时估值链路，或验证任意实际 API Key 的权限与实时数据质量。

## 在网页中操作

在工作台输入含 `600519.SH` 的研究目标并创建线程，可点「单步执行」观察每一步，也可点「运行研究」自动推进。财务节点会停在审批卡片；同意后继续，拒绝后生成带缺口的摘要。计划上方的「故障情景」可在新线程中选择工具失败、数据缺失、过期或冲突，查看失败重试和降级结果。报告可导出 Markdown；检查点可导出/导入 JSON。左侧「长期记忆」可维护偏好和研究笔记，后续新线程会继承。

「工具与连接」中的扶摇自检会单独调用服务端行情快照；自检结果只展示连接状态、上游时点和请求 ID，**不会写入演示线程的证据或报告**。`GET /api/capabilities` 的 `configured: true` 只表示环境变量非空，不表示实际密钥有效或数据已成功读取。

## 产品流程与 Agent Harness

1. 输入研究目标。演示执行器只支持 `600519.SH`。没有识别到代码时会明确采用该演示默认标的；其他代码直接停止，避免将同一组样本套给不同公司。
2. `createRun` 注册五项能力，并生成固定的「范围确认 → 行情 → 估值 → 财务 → 摘要」计划。每次 `advanceRun` 最多推进一个可执行步骤，事件流记录调用和结果。
3. 财务步骤标为 `approval`。同意才执行；拒绝会跳过该步骤，报告把财务证据缺口列为待核验项。可暂停、恢复、停止，失败后重试；重试不重复已完成的步骤。
4. 每步完成后生成检查点，记录版本、保存时间和已完成步骤。上下文的 token 数是**启发式估算**，超过阈值才压缩成摘要；原始证据仍保留在 `evidence`，审批状态留在独立字段。
5. 报告将事实、推断、未知分区。事实引用证据 ID；证据记录来源、标的、数据时点、取数时点、单位、统计口径、原始字段/值、请求 ID 和质量标记。缺失、过期或冲突数据不会被列为正常事实。

代码映射：`lib/harness.ts` 是执行状态机与工具注册表，`lib/demo-data.ts` 是合成样本，`lib/fuyao.ts` 是真实服务端代理的参数与信封适配器，`app/api/fuyao/route.ts` 和 `app/api/capabilities/route.ts` 提供 API，`app/page.tsx` 是工作台界面。线程、记忆和检查点保存在浏览器 `localStorage`；运行中的线程刷新后转为暂停状态，等待用户恢复。这是本机体验，不是跨设备账户存储或数据库审计日志。浏览器清理站点数据、无痕窗口或设备切换会失去这些状态。

默认停止阈值是最多 7 个执行步骤、演示估算成本 0.03 USD、演示累计时延 6000 ms。界面中的成本和时延由固定演示参数累计，**不是扶摇账单或真实网络耗时**。事件流和检查点可用于理解执行过程，不等同于生产级分布式追踪。

## 数据、时点与合规边界

- 演示样本仅有贵州茅台 `600519.SH`，是人为构造值。行情和估值示例时点为 `2026-09-30`，财务示例期末为 `2026-06-30`；样本取数/事件时间也由固定演示时钟产生。所有数字、百分比和估值分位都不能当成真实行情或真实财报。
- `daily.close`、`valuation.pe_ttm` 等字段名属于本地演示证据模型，不是对扶摇当前 REST 响应字段的逐项承诺。真实扶摇响应应按其官方文档的字段、单位、时间戳和报告期口径独立解析与核验。
- 报告只服务于研究流程演示，不输出确定性涨跌预测、收益承诺或直接买卖建议。事实、解释与未知必须分开；任何真实投资判断需要进一步核对交易所行情、公司公告及有权限的数据源。
- 真实接入出现 `null`、空数组、过期、相互矛盾、限流或权限不足时，应明确呈现数据缺口并阻止“正常”结论；不能用演示数据静默兜底。API Key、用户持仓和隐私数据不得写入仓库、事件日志或公开截图。

## 已知未做

- 没有通用自然语言 LLM 自主规划器。计划、摘要文本、上下文压缩和工具路由由可复现的 TypeScript 规则实现；AI 用于开发过程，运行时没有模型调用。
- 没有真实扶摇数据驱动的完整研究线程；真实服务端适配 API 与演示 Harness 尚未合并。估值分位、财报同比等演示指标也未由真实原始序列重新计算。
- 没有 iFinD 连接、跨设备同步、用户级权限体系、生产审计存储、真实计费、交易能力或投资建议。
- JSON 检查点导入只做基础结构校验；请只导入自己保存、可信的检查点文件。当前没有文件签名或跨设备身份校验。
- 真实 API 可用性、授权范围、响应字段和数据时效需要在持有有效 API Key 的环境中继续验收。Sites 源码仓库的匿名读取权限需另行核验。

## 参考

- [题目 13：投资 X Buddy](./docs/13_投资XBuddy.md)
- [扶摇官方文档索引](https://fuyao.aicubes.cn/llms.txt)
- [扶摇官方 API 文档](https://fuyao.aicubes.cn/docs/)
