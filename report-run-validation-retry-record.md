# Report Run Lane 校验与重试记录

这份记录解释一次 `where-tokens-went` Report Run 为什么让三个 Lane 都执行了第 2 次尝试，以及现有证据能确定到什么程度。

## Run 概况

| 项目 | 值 |
| --- | --- |
| 记录日期 | 2026-09-29 |
| Run ID | `1e2da984-9368-43e4-b0cd-966503aadaff` |
| Harness | `codex` |
| 项目范围 | 当前项目 `D:\project\agent-audit` |
| 时间范围 | 2026-09-22 17:58 至 2026-09-29 17:58 |
| Locale | `zh-CN` |
| Audit fingerprint | `c27a6800997cd14b51552139689c775668027f2ec5543221194e33a19ca12d70` |
| Bundle version | `0.1.0+4c9c7535a8f0b38995b84d04c298d5170bab7c1f3698929e85e82f1c2c7dbc7e` |
| 最终状态 | `completed` |
| 最终报告状态 | `ai-enhanced` |
| 是否降级 | `false` |

结论先说清楚：三个 Lane 的第 1 次尝试都在最外层 JSON 解析阶段失败，错误码都是 `MODEL_OUTPUT_INVALID_JSON`。第 2 次尝试均通过校验并被接受。经后续任务调用证据及 SHA-256 哈希比对已确认根因：本次首次失败并非模型输出格式不稳定，而是 Lane Worker 为确认 `report-run ai-accept` 参数用法，先调用了当时不支持的 `--help`，随后以空 stdin 探测调用了 `ai-accept`；CLI 原逻辑将空 stdin 登记为正式模型输出送入 `JSON.parse`，从而以 `MODEL_OUTPUT_INVALID_JSON` 误消耗了第 1 次 attempt 并签发了重试 ticket。三个首次输出的 SHA-256 均为 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`（即空字符串哈希）。这不是模型生成的 JSON 格式错误，而是命令探测越过了提交边界。

## 校验器实际接收的是什么

每个 Lane 有两类输入，不能混为一谈。

### 模型生成输入

Worker 读取本 Lane 的输入 Projection 和对应的源 Prompt，再生成结果。Run 中记录的 Projection 如下：

| Lane | Projection 文件 | 大小 | SHA-256 |
| --- | --- | ---: | --- |
| `report-synthesis` | `lanes/report-synthesis/input.json` | 2,658,918 bytes | `0cdf52ec6434d99bf5c8c67dd7eb5ff1b6348cfe8ef6ef9a8d544c8231bf57` |
| `key-session-analysis` | `lanes/key-session-analysis/input.json` | 443,141 bytes | `67b8c44e03a817e68fc3e85765e60b32e1312321991343a95c00bd7f3daf33d9` |
| `skill-insights` | `lanes/skill-insights/input.json` | 43,558 bytes | `ad9e729c3895001e31cf1f54e6dd695e73488d97cc298fce7a65ad4d1f5c4bbd` |

这些文件说明模型各自看到了什么范围，但它们不是触发本次错误的校验输入。

### 校验器输入

Worker 随后通过 `report-run ai-accept` 把模型生成的原始文本提交到标准输入。在本次故障发生时，CLI 尚未设置空输入门禁，直接对 stdin 文本执行严格的 `JSON.parse`（Ticket 0032 现已在解析前增加非空 stdin 门禁）。只有非空且解析成功，才会进入本 Lane 的字段、Evidence、指纹和内容约束校验。

第 1 次的实际失败发生在这个最外层解析步骤。因此，当时没有进入后续的 Evidence 或业务字段校验。

校验器在解析失败时记录的错误形状是：

```json
{
  "code": "MODEL_OUTPUT_INVALID_JSON",
  "fieldPath": null,
  "message": "Model output was not valid JSON."
}
```

这里的 `fieldPath: null` 很重要。它表示校验器还没有定位到某个字段，不是已经发现了 `overview.evidenceRefs`、`snapshotId` 或某个 Session 字段错误。

## 三个 Lane 分别要求什么

### `report-synthesis`

模型生成输入由报告级 Projection 和 `prompts/report-synthesis.md` 组成，包含当前 Audit 的摘要、排名、Turn 信息、自动检查、报告指标和 Token accounting。

校验要求是：

- 输出必须是单个 JSON 对象，不能是数组，也不能带 Markdown 围栏或前后解释文字。
- `auditFingerprint` 必须等于当前 Audit 的 fingerprint。
- `overview` 必须是对象，包含非空的一两句摘要和一至三个可解析的 Evidence 引用。
- `findings` 必须是列表，最多五项。每项需要标题、分析、Evidence 引用、支持等级和不确定性字段。
- `support` 只能是 `strong`、`moderate` 或 `limited`。
- 有 Findings 时，`noStrongFindingReason` 必须为空。没有 Findings 时，必须说明原因。

第 1 次的实际结果是：原始输出不是可解析 JSON，触发 `MODEL_OUTPUT_INVALID_JSON`。因此，记录中没有证据表明它违反了 fingerprint、Evidence 引用数量或 Findings 字段规则。

第 2 次结果是：`ai-accept` 接受，报告合成结果进入最终组合。

### `key-session-analysis`

模型生成输入由 Top 3 Token 排名 Session、对应 Turn 记录、选定的 Content Evidence packets 和 `prompts/key-session-analysis.md` 组成。

校验要求是：

- 输出必须是按 Token 排名顺序排列的 JSON 数组。
- 每项必须属于当前 Audit 的 Top 3 Session，并携带正确的 `sessionId` 和 `auditFingerprint`。
- `taskContext` 必须描述该 Session 实际在做什么，不能只写排名或用量大小。
- `primaryFinding` 可以是有效 Finding，也可以是 `null`。如果有 Finding，必须有同一 Session、且已在 `evidenceRead` 中读取的 Evidence ID。
- `recommendation` 必须与 Finding 配套，不能在 Finding 为 `null` 时单独存在。
- `evidenceRead` 必须准确描述选定的 Turn、选择理由和未读取范围。
- Codex Session 的 Token accounting 未对账时，不能使用 `strong` 支持等级，且必须保留具体限制说明。
- 不得复制原始历史内容，不得把跨 Session 或未读取的 Evidence 当作当前 Session 的证据。

第 1 次的实际结果仍然是最外层 JSON 解析失败，错误码为 `MODEL_OUTPUT_INVALID_JSON`。因此，没有证据表明第 1 次具体违反了 Top 3、Evidence、Token accounting 或推荐字段规则。

第 2 次结果是：`ai-accept` 接受，Key Session Analysis 进入最终组合。

### `skill-insights`

模型生成输入由 Skill Projection、不可变 Skill Snapshot 和 `prompts/skill-insights.md` 组成。

校验要求是：

- 输出必须是对象，包含 `snapshotId` 和 `insights` 数组。
- `snapshotId` 必须与本次 Run 冻结的 Skill Snapshot 完全一致。
- 每条洞察必须包含可用的身份、标题、Reveal、观察、对照和解释字段。
- 洞察的 `kind`、候选类型、支持强度和 Evidence 必须使用允许的值，并能回溯到当前 Snapshot 或当前用量。
- 至少要有一条通过验证的 Skill Insight，否则 Lane 不能接受。
- 无法由用量和 Skill 内容共同支持的结论会被拒绝或丢弃，不能由模型自行补足。

第 1 次的实际结果也是 `MODEL_OUTPUT_INVALID_JSON`。解析失败发生在 `snapshotId` 和洞察内容校验之前，所以不能把失败归因于 Snapshot 不匹配、缺少核心字段或 Evidence 不足。

第 2 次结果是：`ai-accept` 接受，Skill Insights 进入最终组合。

## 时间线与状态含义

三条 Lane 的时间线都是同一种模式：

1. 第 1 次 `ai-start` 启动模型生成。
2. Worker 提交原始文本。
3. `JSON.parse` 失败，校验器写入 `MODEL_OUTPUT_INVALID_JSON`，并把本次中间状态记录为 `ai-fallback`。
4. 因为当前是第 1 次尝试，Runner 自动创建第 2 次的 retry ticket。
5. 同一个 Worker 修复输出并重新提交。
6. 第 2 次 `ai-accept` 成功，Lane 状态变成 `accepted`。

这里的 `ai-fallback` 是第 1 次拒绝后的中间状态，不代表最终报告使用了降级结果。只有第 2 次仍然失败，Lane 才会以 fallback 结果结束并让 Run 降级。本次三个 Lane 都在第 2 次接受，因此最终 manifest 记录为：

- `report-synthesis`: `accepted`，尝试次数 `2`
- `key-session-analysis`: `accepted`，尝试次数 `2`
- `skill-insights`: `accepted`，尝试次数 `2`
- Run `status`: `completed`
- `degraded`: `false`

## 哪些事实已经确定，哪些仍然未知

### 已确定

- 三个 Lane 都发生了第 1 次失败。
- 三个第 1 次失败的错误码完全相同：`MODEL_OUTPUT_INVALID_JSON`。
- 第 1 次失败发生在语法解析层（空 stdin 字符串无法被 `JSON.parse` 解析），而不是字段语义层。
- 三个 Lane 首次输出的 SHA-256 均为 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`，证实输入确为空字符串。
- 根因已确认为 Worker 在缺乏 `--help` 时的空 stdin 参数探测，而非模型输出不稳定或格式问题。
- 三个 Lane 都通过第 2 次重试（正式模型输出）。
- 最终报告使用了 AI 增强结果，没有进入最终降级报告路径。
- `HOST_TIMING_UNAVAILABLE` 只表示 Worker 没有提供可接受的模型耗时记录，不是触发重试的校验错误。

### 遗留说明与修复方案

- 原先假设的“代码围栏、前后解释文字、截断、引号转义等模型生成不稳定”均已排除，根因已确认为 Worker 参数探测越过提交边界。
- Ticket 0032 彻底修复该问题：为 `report-run ai-accept --help` 增加只读帮助入口，并在 output hash、artifact 写入、validation 和状态提交之前立即拒绝空或纯空白 stdin，避免误消耗 attempt。

## 证据文件

Run 完成后，敏感 Lane 原始输出和临时验证文件按清理策略删除，只保留以下文件：

- `C:\Users\admin\AppData\Local\Temp\where-tokens-went-runs\8bb6bbac-32d1-4c24-9c91-b0f42ea53099\trace.jsonl`
- `C:\Users\admin\AppData\Local\Temp\where-tokens-went-runs\8bb6bbac-32d1-4c24-9c91-b0f42ea53099\manifest.json`
- `C:\Users\admin\AppData\Local\Temp\where-tokens-went-runs\8bb6bbac-32d1-4c24-9c91-b0f42ea53099\audit.json`
- `C:\Users\admin\AppData\Local\Temp\where-tokens-went-runs\8bb6bbac-32d1-4c24-9c91-b0f42ea53099\report.html`

关键实现位置：

- `src/cli.ts` 的 `report-run ai-accept` 在读取 stdin 后先进行非空白门禁检查，避免空探测误消耗 attempt；确认非空后再计算输出哈希并执行 `JSON.parse`，解析失败时才记录 `MODEL_OUTPUT_INVALID_JSON`。
- `src/key-session-analysis.ts` 负责 `report-synthesis` 和 `key-session-analysis` 的语义校验。
- `src/skill-insights.ts` 负责 `skill-insights` 的 Snapshot、字段和 Evidence 校验。

这份文档记录的是 2026-09-29 这一次 Run 的诊断快照，不把本次空 stdin 参数探测故障推广成所有 Worker 或所有 Run 都会出现的固定规律。
