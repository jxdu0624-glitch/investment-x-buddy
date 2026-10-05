# AI 使用与验证记录

记录日期：2026-10-05（Asia/Shanghai）。本记录针对本仓库当前代码和合成数据演示，不把 AI 生成文字当成金融事实。

## AI 的角色

| 环节 | AI 参与 | 结果的校验方式 |
| --- | --- | --- |
| 产品与架构 | OpenAI Codex 根据[题目原文](./docs/13_投资XBuddy.md)拆解 Agent Harness 和投研界面：计划、工具、权限、上下文、长期记忆、检查点、事件与证据 | 对照源码中的状态字段、转移函数和界面操作；逐项核对题目交付要求 |
| 代码实现 | Codex 辅助编写 React/TypeScript 工作台、演示 Harness、扶摇服务端适配器和自动化测试 | TypeScript/构建检查、Node 测试、手动浏览器验收；实际完成状态见[测试说明](./TESTING.md) |
| 数据与文案 | Codex 编排固定演示场景、解释性报告文案和错误提示 | `lib/demo-data.ts` 全部标成合成数据；报告区分事实、推断、未知；真实 API 路由不把失败替换为样本 |
| 金融 API 契约 | Codex 查阅扶摇[官方文档索引](https://fuyao.aicubes.cn/llms.txt)及其官方仓库[行情](https://github.com/HiThink-Tech/Financial-API/blob/main/docs/api/a-share/prices.md)、[财务报表](https://github.com/HiThink-Tech/Financial-API/blob/main/docs/api/a-share/financials.md)契约 | 对照官方端点、`X-api-key`、响应信封、业务 `code` 和 `request_id`；使用伪造响应的单元测试核验适配逻辑 |

产品**运行时没有大模型调用**。`lib/harness.ts` 是固定五步状态机与规则化摘要，不应称为会自主搜索、动态制定任意研究计划的 LLM Agent。AI 对本项目的作用是开发辅助；运行时的可解释性来自明确的工具注册、状态转移、审批、检查点和证据引用。

## 已落实的纠偏与证据

以下列出交付中经源码审查或自动化测试确认的纠偏；它们不是对真实市场数据的验证。

| 容易产生的错误或不合理结果 | 当前处理 | 可核查位置 |
| --- | --- | --- |
| 把合成价格说成扶摇实时行情 | 演示样本标 `demo: true`，来源含“本地演示”；报告明确真实数据未核验。服务端扶摇入口独立于演示线程 | `lib/demo-data.ts`、`lib/harness.ts`、`app/api/fuyao/route.ts` |
| 用户改查其他股票仍套用贵州茅台样本 | 解析不支持的股票代码后直接停止，不产生证据 | `createRun`；`tests/harness.test.ts` |
| 跳过财务授权却照常声称已核验 | 拒绝时跳过财务工具，在报告的未知项列出证据缺口 | `rejectRun`、`makeReport`；`tests/harness.test.ts` |
| 扶摇 HTTP 200 被误判为业务成功 | 检查统一信封的 `code`，保留 `request_id` 与显式 `data: null`；错误映射为本地 HTTP 状态 | `lib/fuyao.ts`；`tests/fuyao.test.mjs` |
| 模型/工具失败后静默造数或重复成功步骤 | 失败进入 `failed`；重试只重排失败步骤，已完成步骤和证据保持原状 | `retryRun`；`tests/harness.test.ts` |
| 缺失、过期或冲突数据进入正常事实 | 演示故障注入会标记质量或省略值，报告仅把正常证据列为事实，并显式列出待核验项 | `advanceRun`、`makeReport`；`tests/harness.test.ts` |
| API Key 暴露给浏览器或任意转发 URL | 密钥只读服务端环境变量；请求只允许固定上游路径和参数白名单 | `app/api/fuyao/route.ts`、`lib/fuyao.ts`；`tests/fuyao.test.mjs` |

这些机制不能代替真实数据验收。测试中的扶摇响应由测试代码构造，未证明某个实际账号已有权限、数据源当前可用，或真实字段口径满足最终投研需求。

## 人工验证记录边界

当前没有可独立核查的“候选人亲自修改了哪一行、何时手动验收”的签名记录，因此不把自动化审查冒充人工完成。提交人应在发布前补充自己的实际记录，例如：

| 待补人工验收 | 结果/时间/执行人 |
| --- | --- |
| 在无站点登录态、无开发环境的浏览器中打开公开站点 URL，完成一条研究线程 | Codex 自动化于 2026-10-05 在 Chrome 无痕窗口完成；提交人亲自复核待记录 |
| 点击每条核心结论，核对来源、日期、单位、原始字段与异常提示 | 待记录 |
| 实际使用有权限的扶摇密钥进行联调，并核对上游响应字段和业务 `code` | 若未进行，明确标为“未进行” |
| 检查源码仓库、部署配置及截图中无 API Key、持仓和隐私数据 | 待记录 |

若要报告“候选人修正了 AI 的错误”，请只记录真实发生的修改、修正前后差异及核验方式，不补写未经发生的过程。
