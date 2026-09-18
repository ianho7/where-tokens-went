---
status: accepted
---

# Skill 洞察架构与确定性证据门禁

where-tokens-went 现有报告能够列出 Skill 的调用次数、任务数、关联 Token 和等价成本，回答了“用户使用了哪些 Skill”。但这一扁平表格无法解释用户的 Skill 体系如何实际运作：哪些 Skill 赋予了模型原本缺失的关键能力（Capability Delta），哪些指导逐渐沦为强模型自带的通用流程（Generic Procedure），哪些同一家族的 Skill 存在重复维护，以及哪些低频重型 Skill 适合做渐进披露（Progressive Disclosure）。

为了提供具备“十秒顿悟”价值的深度洞察，同时避免大模型出现过度推断与因果幻觉，本架构确立以**确定性筛选（Candidate Selector）**、**只读快照（Skill Snapshot）**、**AI 并发推理（Parallel AI Lane）**与**严格代码门禁（Evidence Gate）**为核心的实现体系。

## 核心决策

### 1. 明确分析职责分工：“代码负责发现哪里值得看，AI 负责解释为什么值得看”
- **确定性计算层**：计算全局与单 Skill 指标（`callShare`、`callsPerTask`、`taskCoverage`、长尾统计等），基于明确规则筛选至多 5 个 Unique 候选 Skill。
- **只读快照层（Skill Snapshot）**：在 `report-run prepare` 阶段，严格按 `工作区 harness 路径 → 工作区 .agents → 用户 harness 路径 → 用户 .agents → unavailable` 顺序检索候选 Skill 的 `SKILL.md`，并将其正文、SHA-256 哈希与引用文件元数据固化为 Snapshot 产物。避免运行时磁盘竞争与文件二次读取漂移。
- **AI 解释层（Host Agent）**：通过静态提示词合同输入使用数据与快照正文，识别 Capability Delta，提取不超过 200 字符的原文证据片段（`evidenceExcerpt`），形成 3~5 条候选洞察。
- **代码证据门禁（Evidence Gate）**：在 `report-run compose` 时对 AI 输出执行阻断式校验，确保指标真实、引用逐字匹配、因果与重复注入措辞被剔除。

### 2. 候选筛选规则与 24k 预算限制
- 候选 Skill 总量硬性上限为 5 个（高频核心最多 2 个、高 callsPerTask 最多 2 个、Family 候选最多 1 组/2 个，所有类别去重后总数 ≤ 5）。
- 建立成本与稳定性预算门禁：当选中 Skill 的 `SKILL.md` 预估 Token 总和 ≤ 24,000 tokens 时，执行单批次（Single-batch）模型推理；若超出预算，自动切入两阶段降级（Two-stage Fallback，先逐一提取 Skill Profile，再做聚合 Synthesis）。

### 3. 调度融入现有 DAG 并发机制与耗时跟踪
- 深度复用 Issue 0008 / 第二阶段优化建立的 DAG 并发模型：`prepare` 生成 `audit.json` 与 `skill-snapshot.json` 后，`skill-insights` 作为并发流水线的一轨与 `report-synthesis` 和 `key-session-analysis` 协同推进，保持并发上限，避免串行等待。
- 轻量复用现有 `DEFAULT_RUN_STAGES` 与 timing trace 扩展 `skill-candidate-select`、`skill-snapshot` 与 `skill-insights` 阶段耗时记录，不引入多余的 telemetry 系统。

### 4. 证据与因果红线门禁（Evidence Gate）
- **关联不等于因果（associated ≠ caused）**：拒绝任何将关联用量称为“该 Skill 导致/浪费/消耗了 N 个 Token”的陈述，只能表述为“该 Skill 涉及/关联了高用量任务”。
- **单任务频次不等于重复注入（callsPerTask ≠ repeated injection）**：高 `callsPerTask` 仅作为行为频次信号（提示“可能存在重复指导”），严禁表述为“完整 SKILL.md 被重复注入了 N 次”。
- **引用严格逐字校验**：`evidenceExcerpt` 最长 200 字符，经过换行与空白规范化后仍必须能在 Snapshot 对应 `SKILL.md` 中完成确定性 substring match（重点核验引用真实性而非机械字节完全一致）；不存在或超长的摘录直接废弃对应 Claim，不使用宽松模糊匹配。

### 5. Kami 风格可视化合同
- 在 HTML 报告中放置于“Skill 使用证据”表格上方，采用与 Kami 规范一致的紧凑卡片（Quiet Card）排版。
- 展示 0~5 条高置信度洞察（通常 3~5 条；若证据不足允许仅展示 0~2 条甚至空状态，绝不为了凑数或填满卡片而制造低价值洞察）；不向用户展示内部评级（如 High/Medium/Low）、不展示内部打分、不输出 Lint 警告。

## 结果与边界

- 本特性属于报告解释层能力的深化，绝不演化为 Skill 编辑器、自动改写工具、自动删除/合并工具或 Skill 排行榜。
- 严格遵循 `src/` 与 `prompts/` 作为单一权威源，通过打包脚本分发至各 Harness，不直接修改分发产物。
