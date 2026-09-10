# where-tokens-went MVP：Claude Code 与 Codex 的历史数据源与 Reader 约定

> 调研快照：2026-09-10。当前实现仅支持 Claude Code 和 OpenAI Codex。Pi（`earendil-works/pi`）与 DeepSeek Harness 的 Reader 暂停支持；下方对应章节保留为未来恢复参考，不代表当前 CLI、Skill 或安装脚本仍支持它们。目标是：工具由哪个 Harness 调用，就只读取该 Harness、当前项目的既有本地历史；不默认扫描其他 Harness，也不把实时采集放进 MVP。

## 结论先行

当前支持的两种 Harness 都能支撑“当前 Harness / 当前项目 / 最近一段时间”的历史诊断，但接口稳定性不对称：

| Harness | MVP 首选历史源 | 可得到的关键事实 | 主要风险 |
|---|---|---|---|
| Claude Code | `~/.claude/projects/<project>/<session-id>.jsonl` | 消息、工具调用/结果、模型响应 usage；子 Agent sidecar | 路径和 JSONL 存在是官方契约，**逐字段 transcript schema 并未完整发布** |
| Codex | `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` | thread/turn/item、工具、错误、压缩、逐响应或增量 usage、子 Agent 关系 | rollout 是官方开源实现细节，演进快；可用 app-server 降低耦合 |

MVP 的共同原则：

1. **入口显式指定 Harness**，Reader 不自行探测两种来源。
2. **当前项目由调用入口传入绝对 cwd**；不要依赖目录名反解。
3. **只读、流式、容错解析**；未知记录保留计数并跳过，不因一个新事件类型使整份报告失败。
4. 每项结果携带最小来源标签：`reported`、`derived`、`estimated` 或 `unavailable`。
5. Token 优先使用单次响应/attempt 的 usage；累计快照只能取末值或做差，绝不能逐行求和。
6. 工具输出可能包含源码、终端输出、Prompt、凭据和 base64 文件。默认仅计算大小和哈希，不把原文写入报告或送给另一个模型。

## MVP Reader 的最小输出

Reader 不需要先构造通用事件平台。两个 Reader 只需返回下列最小记录，缺失字段为 `null`，不得补零：

```text
Session
  harness, session_id, project_cwd, started_at, ended_at?
  parent_session_id?, model_provider?, source_version?

ModelCall
  session_id, call_id?, timestamp, model?, provider?
  input_tokens?, cached_input_tokens?, cache_write_tokens?
  output_tokens?, reasoning_tokens?, status?, error?
  provenance = reported | derived | estimated | unavailable

ToolCall
  session_id, call_id, timestamp, tool_name, input_size?
  result_size?, is_error?, duration_ms?

Lifecycle
  session_id, timestamp, kind = retry | compaction | subagent | interrupted
  related_id?, details?
```

“成本”不放进 Reader 的必填契约。Claude Code 与 Codex 都不把成本作为 Reader 必填值；成本需要价格表和生效日期，是后续派生值，不能标为 `reported`。

## 1. Claude Code

### 官方明确的事实

- Claude Code 把本地 session transcript 以明文 JSONL 存在 `~/.claude/projects/<project>/<session-id>.jsonl`；`<project>` 从工作目录派生。可用 `CLAUDE_CONFIG_DIR` 改变根目录，默认保留 30 天，可由 `cleanupPeriodDays` 调整；`CLAUDE_CODE_SKIP_PROMPT_HISTORY` 或非交互模式的 `--no-session-persistence` 会关闭持久化。[Manage sessions](https://code.claude.com/docs/en/sessions#export-and-locate-session-data)
- 官方把 transcript 概括为“每一行是一条 message、tool use、tool result 或 metadata”，并明确 `projects/<project>/<session>.jsonl` 是完整会话记录。[Explore the `.claude` directory](https://code.claude.com/docs/en/claude-directory)、[How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)
- Hook 输入稳定提供 `session_id`、`transcript_path` 和 `cwd`。这对于未来做当前 session 的精确定位有用，但 MVP 分析已完成历史时无需安装 Hook。[Hooks reference](https://code.claude.com/docs/en/hooks#common-input-fields)
- 本地 transcript 是明文，可能包含完整 Prompt、模型回复、工具参数和工具结果。[Data usage](https://code.claude.com/docs/en/data-usage#data-retention)

### 当前可观察但未形成完整格式契约的字段

官方文档没有发布一份可版本化的 transcript JSON Schema。官方仓库中的插件示例会从 transcript 的 assistant 行读取 `message.content`，说明该形状是当前生态实际使用的，但仍应视为实现观察，而不是稳定 API。[Anthropic 官方插件示例](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/plugin-settings/references/real-world-examples.md)

当前历史通常可观察到：

- session/cwd/timestamp，以及消息的 `uuid` / `parentUuid` 关系；
- assistant 的 model、`message.id` / request id 和 `message.usage`；usage 常见字段为 `input_tokens`、`output_tokens`、`cache_creation_input_tokens`、`cache_read_input_tokens`；
- 新版 usage 还可能按 `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` 区分 cache-write TTL；只有读到 TTL 细节时才对 cache-write 做精确成本匹配；
- assistant 内容中的 `tool_use`，以及 user/tool-result 内容和错误信息；
- 某些版本的 assistant 行可观察到 `attributionSkill`，可作为版本化 Skill 归因；显式 Skill tool 记录只能作为较弱的调用证据；
- `cost-state` 可能携带会话累计 `totalCostUSD`；Reader 只保留选定 Session 的最终有效快照，不把它与每条响应成本相加；
- compaction 边界或摘要类 metadata；
- session 目录下的子 Agent transcript、tool-result sidecar 与 meta 文件。

上述细节没有完整官方 schema 保证。官方 issue 中已有真实版本出现“同一模型响应多条流式 assistant 记录，usage 重复”的报告，因此按行累加会高估；应优先按响应/消息 id 去重。[重复 usage 的官方仓库问题记录](https://github.com/anthropics/claude-code/issues/41346)

### 字段可用性

| 能力 | 判断 |
|---|---|
| session / project / timestamp | 有；路径与基础 transcript 由官方文档保证，逐行字段需容错 |
| model / token / cache | 当前可从 assistant usage 读取；字段 schema 非正式契约 |
| cost | 可能有 `cost-state` 的会话累计快照；保持 `reported`，但 API 等价成本仍需精确价格表；缺失则 `unavailable` |
| tool call / result / error | 有；内容可能非常敏感、非常大 |
| retry | 没有稳定的独立历史事件契约；只能基于重复 request、错误行谨慎派生 |
| compaction | 可观察，但记录形状未形成公开稳定 schema |
| subagent lineage | sidecar 可观察，但目录/meta 细节应视为版本相关 |

### 推荐最小 Reader 行为

1. 根目录取 `CLAUDE_CONFIG_DIR`，否则取用户目录下 `.claude`。
2. 由入口传入当前 cwd。遍历 `projects/*/*.jsonl` 的候选 header/前几条记录并按记录内 cwd 过滤；不要自行复制未文档化的 `<project>` 编码算法。
3. 逐行解析；按 assistant `message.id` 或 request id 去重。同一 id 多条记录时保留最完整/最后完成的一条 usage。
4. 工具 call/result 通过 tool-use id 配对，只计算 UTF-8 字节数/字符数；报告中不回显正文。
5. 识别不了的 metadata 或 compaction 记录只计数，不报错；输出 `source_version`（若能读到 Claude Code 版本）。
6. 默认忽略正在写入的最后一条破损 JSON；文件读取前后比较 size/mtime，变化则标记 `partial=true`。

## 2. OpenAI Codex

### 支持面的优先级

Codex 有两个可用面：

1. **更稳定但稍重：`codex app-server`**。它是 Codex 用来驱动 VS Code 等富客户端的正式接口，支持 `thread/list`、`thread/read`、`thread/turns/list` 和 `thread/items/list`；还能按 cwd 过滤 thread。它可以为当前安装版本生成完全匹配的 TypeScript/JSON Schema。[App Server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#message-schema)
2. **MVP 最直接：只读 rollout JSONL**。官方开源 recorder 明确把 session rollout 写成可检查的 JSONL；当前布局是 `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread-id>.jsonl`，归档位于 `archived_sessions`。[Rollout recorder](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs)、[官方测试中的路径构造](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/common/rollout.rs)

建议 MVP 先实现 rollout Reader，同时把“通过 app-server 读 history”保留为兼容性逃生口，而不是同时实现两套。

### 当前 rollout 能提供什么

这是**官方仓库源码所描述的当前实现**，不是独立发布的永远稳定文件规范：

- 每行是带 timestamp/ordinal 的 `RolloutItem`；包括 `session_meta`、`turn_context`、`response_item`、`event_msg`、compaction 等记录。
- `SessionMeta` 包含 root `session_id`、thread `id`、`forked_from_id`、`parent_thread_id`、timestamp、cwd、originator、CLI version、source、model provider，以及子 Agent nickname/role/path 等可选字段。[当前 `SessionMeta` 定义](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs#L2822-L2858)
- response/item 与 event records 能表达 user/assistant message、reasoning、function/custom/MCP/shell/apply-patch 等工具过程、stdout/stderr/exit status、错误、turn start/end/abort。[当前事件定义](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs#L1302-L1434)
- `TokenUsage` 当前包含 input、cached input、cache-write input、output、reasoning output、total；`TokenUsageInfo` 同时包含累计的 `total_token_usage` 和本次增量 `last_token_usage`。源码明确后者被追加到前者，因此 Reader 应加总 `last_token_usage`，或直接取最终累计值，不能把累计值逐行求和。[当前 token 类型与累加语义](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs#L2061-L2129)
- 新版事件还定义了 `RawResponseCompleted`，表示“一次上游 Responses API 完成事件的精确 usage，非累计、非估算、非 replay”；存在时应优先使用它并按 `response_id` 去重。[当前 `RawResponseCompletedEvent`](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs#L1786-L1793)
- Codex 的本地 `session_index.jsonl` 维护 Session 的 `id`、`thread_name` 和更新时间；Reader 可用同一 `id` 的最新 `thread_name` 作为可读标题，但标题缺失时必须回退到 ID，不从 rollout 内容猜测。[当前 Session index 实现](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/session_index.rs)
- compaction、stream error/断线、too-many-attempts 等均可观察；`SessionMeta.parent_thread_id` 和 subagent source 提供父子关系。[当前错误与 lineage 定义](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs#L1720-L1778)
- `turn_context` 提供可用于保守 Skill 边界匹配的 turn id；结构化 Skill 输入是最强的调用证据。对 `skills/<name>/SKILL.md` 的资源读取或该 Skill `scripts/` 下的脚本执行，只有在同一 turn/调用关系可验证时才记录为 `invoked`；普通文字、目录列表或未知字段不升级状态。[Codex Skill invocation source](https://github.com/openai/codex/blob/main/codex-rs/core/src/skills.rs)

官方 OTel 文档证明 Codex 内部有更精确的 attempt 级信息：`codex.api_request` 有 attempt/status/error，`codex.sse_event` 在 `response.completed` 带 token，另有 tool decision/result。但它默认关闭且不是既有历史，因此不进 MVP；只作为未来发现 rollout 不足时的选项。[Codex observability](https://learn.chatgpt.com/docs/config-file/config-advanced#observability-and-telemetry)

### 字段可用性

| 能力 | 判断 |
|---|---|
| session / project / timestamp | 有；`session_meta` / `turn_context` |
| model / provider | 有，但 model 可能按 turn 变化，应读 turn context，而非只看 session meta |
| token / cache / reasoning | 有；优先单响应 `RawResponseCompleted`，其次 `last_token_usage` |
| cost | rollout 未定义通用 reported cost；Codex API 等价成本默认查询 LiteLLM 精确目录项；有可计价 Usage 时按已定价子集给出 `estimated` 金额并暴露覆盖率，没有任何可计价 Usage 时才返回 `unavailable` |
| tool call / result / error | 有；不同工具有不同 item/event 类型 |
| retry | stream error 可见；精确 attempt 数在 OTel 更明确，纯历史需保守推断 |
| compaction | 有显式事件/记录 |
| subagent lineage | 有 parent/fork/source 字段与协作事件 |

### 推荐最小 Reader 行为

1. 根目录取 `CODEX_HOME`，否则取用户目录下 `.codex`；只枚举 `sessions`，默认不包含 `archived_sessions`。
2. 由入口传入当前 cwd；快速读取每个候选的首个 `session_meta` 或使用日期目录/mtime 先裁剪，再精确匹配规范化后的 cwd。
3. 记录 `cli_version`，按 envelope `type` 分派；未知 type 跳过并计数。不要依赖 SQLite 私有表。
4. usage 优先级：`raw_response_completed(response_id)` > 每次 `token_count.info.last_token_usage` > 最终 `total_token_usage`。选定一种来源后不要混加。
5. 工具统一从 item lifecycle 的 started/completed 配对；输出大小从 completed item 的 stdout/stderr/content 计算。只保留摘要，不回显正文。
6. 若未来格式变化导致 rollout 解析失败，切换到与本机版本匹配的 app-server schema，而不是永久兼容所有内部 variant。

### 缓存、首次请求与 Skill 证据边界

Codex 的 `input` 可能已经包含 cache-read/cache-write 子集，不能把三个桶再次相加；Reader 保留源字段，shared analysis 负责拆出 ordinary input 并在不一致时返回 `unavailable`。Claude Code 的四个 usage 桶按互斥组成计算总量。两个 Reader 都只返回元数据和计数，不返回 Skill body、Prompt、回复、源码或工具结果。价格默认且仅按需 GET LiteLLM 模型目录，只提交 Provider/model 标识；若源记录缺少 Provider，则按 Codex→`openai`、Claude Code→`anthropic` 的 Harness 映射查询，显式冲突的 Provider 不强行转换。保留目录来源和查询时间，金额标为 `estimated`；只要有可计价 Usage，就按已定价子集显示部分估算并暴露覆盖率，未定价或不兼容 Usage 明确排除。只有没有任何精确匹配、网络失败或可用价格维度的 Usage 时金额才为 `unavailable`，不抹掉 Token 结果。

首次请求是每个选定 Session 最早有效 ModelCall 的观测负担。Skill 证据状态分为 `available`、`invoked`、`attributed`、`unavailable`；listing 只说明可用，不能推断已调用。直接资源足迹、观测关联和因果影响分别报告，当前没有足以证明因果影响的反事实，因此后者保持 `unavailable`。

后续沟通提取、AI 返修分类和返修率不属于本轮 Reader 或分析边界；本轮不输出这些指标，也不增加对应基础设施。

## 暂停支持：Pi（earendil-works/pi）

以下内容保留调研证据，不代表当前 CLI、Skill 或安装脚本仍支持 Pi。

### 官方明确的事实

Pi 发布了完整的 Session File Format 文档：session 是 JSONL，每行带 `type`；路径为 `~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl`。entry 通过 `id` / `parentId` 形成树，可在同一文件内分支。[Pi session format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md#file-location)

首行 `SessionHeader` 包含 `type=session`、version、id、timestamp、cwd，可选 `parentSession`。当前文档列出 v1（线性）、v2（树）、v3（扩展消息重命名），Pi 自身加载时会迁移旧版本。[版本与 header](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md#session-version)

消息字段是公开文档的一部分：

- assistant：provider、model、timestamp、stopReason/errorMessage、usage；
- usage：input/output/cacheRead/cacheWrite/totalTokens，并自带 input/output/cacheRead/cacheWrite/total cost；
- tool result：toolCallId、toolName、完整 content、可选 nested usage、`isError`；
- assistant content 直接包含带 id/name/arguments 的 tool call。[Message Types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md#message-types)

此外有显式 `model_change`、`thinking_level_change`、`compaction`（含 `tokensBefore`、可选生成摘要的 usage 和 retainedTail）、`branch_summary`、custom、label、session_info。活动分支由 parentId 链决定，不能简单按文件顺序把所有分支都算成一次上下文。[Entry Types 与 Context Building](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md#entry-types)

### 字段可用性

| 能力 | 判断 |
|---|---|
| session / project / timestamp | 有，文档化 |
| model / provider | 有，且支持显式 model change |
| token / cache | 有，按 assistant message/summary usage 报告 |
| cost | 有，按 usage 分桶直接报告；四者中唯一可直接标 `reported` 的成本 |
| tool call / result / error | 有，tool result 可含工具内部 LLM usage |
| retry | 无独立、文档化的 retry entry；error/aborted stopReason 可见 |
| compaction / branch | 有，格式和上下文重建规则均文档化 |
| subagent lineage | `parentSession` 表示 fork/clone/newSession 的父关系；文档未保证它等价于“子 Agent 调度” |

### 推荐最小 Reader 行为

1. 由入口传入 cwd；优先使用官方 `SessionManager.list(cwd)`（若作为 JS/TS 包集成），独立 CLI 则按 header.cwd 过滤，不依赖 `--<path>--` 目录名反解。
2. 首行必读 version；支持 v1-v3，未知更高版本 fail-soft：跳过该 session 并给出升级提示，不猜测。
3. 分析“实际当前会话路径”时，从 leaf 沿 `parentId` 回溯，并按官方 compaction 规则处理 retainedTail / firstKeptEntryId；全文件分支总量应另行标注，避免双算。
4. assistant usage、compaction/branch-summary usage、tool-result nested usage 分别保留来源；nested usage 不要重复并入父 assistant usage，除非格式语义明确它是额外调用。
5. cost 直接使用日志数值并标 `reported`，同时保留币种未知这一事实；不要自行假设都是 USD。
6. tool content 默认只计大小；图片 base64 不输出。

## 暂停支持：DeepSeek Harness

以下内容保留调研证据，不代表当前 CLI、Skill 或安装脚本仍支持 DeepSeek Harness。

### 官方明确的事实

DeepSeek Harness 把 session 定义为 append-only `SessionEvent` 日志，是完整交互历史的唯一真源；模型历史由日志派生。官方产品页宣称系统提示、reasoning、工具调用/结果、子 Agent 调度和每次上下文注入均可追踪。[产品说明](https://deepseek.com/harness/en/#everything-is-a-plugin-every-run-is-traceable)、[Session subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md)

历史存储不是固定路径，而是一个 `SessionPersistence` 能力：提供 create/open/stat/list 等读取语义，官方同时提供 JSONL 和 SQLite backend。[Persistence seam](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence/README.md)

- JSONL backend 的 `root` **必填且没有 backend 级默认值**。每 session 位于 `<root>/--<normalized-cwd>--/<encoded-id>/session.jsonl.zstd`；关闭压缩时为 `session.jsonl`。默认 zstd 文件是多 frame 拼接，逻辑内容仍是 header + SessionEvent JSONL；还可能包含无损 packed chunk rows，必须用官方 decoder 语义展开。[JSONL backend](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence-jsonl/README.md)
- SQLite backend 的 `path` 同样由配置给出；events 表保存 `(session_id, seq, type, time, data, source_event_seqs, surface_op)`，header 单独保存在 sessions row。[SQLite backend](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence-sqlite/README.md)
- CLI 的 `DSH_HOME` 默认为环境变量或 `~/.dsh`，但这不等于 persistence root。应通过 profile 的最终组合配置发现 backend 和路径；`dsh --profile <name> --dump-config` 能在不启动 profile 的情况下显示合成后的配置。[CLI behavior reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md#profile-boot)
- 在 Harness 管理的 shell 内，官方实现提供 `DSH_SESSION_ID`；当 backend 能定位单 session JSONL 时还提供 `DSH_SESSION_JSONL`。这是“由 DSH 内调用”时定位当前 session 的最佳线索。[Agent session identity and log location](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-07-10-agent-session-identity-and-log-location.md)

### 事件与字段

核心事件包括 `turn/start|end`、`step/start|end`、`user/message`、`assistant/message`、`assistant/attempt`、`tool/call`、`tool/result`、`request/header` / `request/context`。事件 envelope 有 `type`、连续 `seq`、`time`、`data`，还可能有 surface replacement 元数据。[SessionEventMap](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md#sessioneventmap--the-event-vocabulary)

- `request/header` 保存下一次请求的完整 provider/model/system/tool schema header；`request/context` 保存路由变化。
- `assistant/message` 可带本次 step 的 usage；没有形成 surface message 的失败/重试/取消 attempt 由 `assistant/attempt` 保存精确 compact stream，usage chunk 仍可恢复。
- `TokenUsage` 的桶彼此不重叠：`inputTokens` 是未缓存输入，另有可选 `cacheReadTokens`、`cacheWriteTokens`、`reasoningTokens`；billed input 是前三者之和。[TokenUsage 定义](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm/src/types.ts)
- tool call/result 有 callId、name、原始 arguments、模型可见 result、可选结构化 error/meta。
- compaction 由插件扩展为 `compaction/start|summary|end`；retry 也可以由插件拥有，因此事件词汇是 merge-extensible 的，不能用封闭 enum 拒绝未知事件。
- header 可带 `parentSession`、`seedLength`、`origin=subagent`、`delegationDepth`、`agentPreset`，足够构造父子 lineage。[JSONL header 说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence-jsonl/README.md#on-disk-layout)

### 字段可用性

| 能力 | 判断 |
|---|---|
| session / project / timestamp | 有，header + event envelope |
| model / provider / request header | 有；request/header 是完整证据 |
| token / cache / reasoning | 有；usage 可能缺失，缺失不能补零 |
| cost | 核心 `TokenUsage` 不含价格/成本；返回 `unavailable` |
| tool call / result / error | 有，且 callId 可配对 |
| retry / failed attempt | 失败 attempt 可由 raw stream 结算；具体 retry 事件由插件扩展，需宽容解析 |
| compaction | 有插件事件和 surface replacement；并非每 profile 都启用 |
| subagent lineage | header 原生支持 parent/origin/depth |

### 推荐最小 Reader 行为

1. DSH 集成入口显式传入 `DSH_SESSION_ID`、当前 cwd，并优先传入 `DSH_SESSION_JSONL`。若要读取当前项目的多份历史，通过 profile 的合成配置确定 JSONL root 或 SQLite path；不要硬编码 `~/.dsh/sessions`。
2. JSONL `.zstd` 必须支持拼接 frame，并调用/复刻官方 `decodeStorageRecord` 的 packed-row 展开规则；不要把物理行数当事件数。SQLite 只读打开，并先校验 `application_id` / `user_version`。
3. 按 `(session_id, seq)` 去重、检查 seq 连续性。读取活动文件时只消费完整 durable prefix。
4. 同一成功 step 可能同时有 usage chunk 和 `assistant/message.usage`，后者是提交后的权威值；失败 attempt 则从 `assistant/attempt.stream` 的 usage chunk 计数。不要把同一 attempt 的两份 usage 重复相加。
5. 未知且可忽略的插件事件跳过并计数；遇到未知不可忽略事件时，该 session 标记 `partial/unsupported`，但其他 session 继续分析。
6. DeepSeek Harness 截至本快照仍明确标注 Developer Preview，核心插件和 API 会继续演进；Reader 必须记录 header version 和安装版本，并把 fixture 从用户真实 session 脱敏截取。[Developer Preview 状态](https://deepseek.com/harness/en/)

## 实施优先级与验收

当前实现优先验证 Codex → Claude Code：

1. **Codex**：先用真实 rollout 打通“当前 cwd 最近 7 天 → 最大 token session → 最大工具输出/错误 → 一条证据化建议”。
2. **Claude Code**：验证相同最小输出契约能容纳另一种 JSONL，并实现响应去重。

每个当前支持的 Reader 的最低验收只需要一份用户自己的脱敏历史样本：

- 能按当前 cwd 找到正确 session，不碰其他 Harness；
- 总 usage 与 Harness 自己显示的量级一致；
- 重跑结果稳定，累计快照或流式重复记录没有被重复计数；
- 能配对至少一种工具 call/result 并计算 result size；
- 能把缺失、估算和直接报告的数据区分开；
- 原始 Prompt、源码和工具输出不会进入默认终端/JSON 报告。

## 暂不进入 MVP

- 跨 Harness 扫描、排行和成本比较；
- OTel collector、Hook 常驻采集和后台 daemon；
- 云端上传、团队 Dashboard、统一事件数据库；
- 完整价格注册表和额度推断；
- 正式跨 Harness 黄金评测平台。

以上能力只有在历史 Reader 无法产生 Aha 结论或真实使用频率证明必要时再增加。
