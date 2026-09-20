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

## 2026-09-20 追决策：从 Usage Insight 升级为 Usage × Content Capability Aha

本节先定义了下一阶段的目标架构与验收边界；P0 现已成组落地到运行时 Prompt、validator、renderer、Report Run artifact 与测试，并已重新打包。P1 Trigger Trace 仍保持 deferred，必须等待 P0 真实报告评估后再决定是否启动，避免把行为机制解释重新扩成 Usage Analytics。

上一阶段的 Reveal-first 已经解决了“统计数字不够直接”的问题，但真实报告仍可能只回答 Skill **怎么被使用**，没有回答 Skill **为什么值得存在**。因此下一阶段不再以增加 Usage 统计或优化三张现有卡片文案为目标，而是把 Skill Insights 的产品职责扩展为三类互补洞察：

1. **Usage Aha**：Skill 系统实际如何被使用，例如核心/长尾分布与行为离群。纯 Usage Insight 仍然有效，但有限卡位中 `pure_usage_topology` 最多保留一条，`behavior_anomaly` 最多保留一条。
2. **Capability Aha**：结合 Usage 与 `SKILL.md` 内容，说明删除整个 Skill 会失去什么，以及删除通用流程脚手架后仍然保留什么能力。Capability Aha 优先于重复的 Usage Insight。
3. **Mechanism Aha**：结合 Usage、内容与触发序列，解释异常行为发生在什么任务阶段。没有触发序列时，只能称为 anomaly，不能称为 lifecycle mechanism。

### 1. Content Profile 必须回答反事实问题

分类标签不再是内容分析的终点。P0 实现的 `SkillContentProfile` 以以下结构回答“删掉什么会失去什么”：

```ts
interface SkillContentProfile {
  skillId: string;
  lossIfRemoved: Array<{
    summary: string;
    role: "localFact" | "hardConstraint" | "tool" | "decisionRule" | "specializedCapability";
    evidenceExcerpt: string;
    whyModelWouldNotKnowThis: string;
    loadingScope: "always" | "task_scoped" | "unclear";
  }>;
  modelNativeScaffold: Array<{
    summary: string;
    evidenceExcerpt: string;
    observed: string;
    interpretation: string;
    rationale: string;
    relativeTo: "capable-current-coding-agent";
  }>;
  scopedContent: Array<{
    summary: string;
    activationCondition: string;
    evidenceExcerpt: string;
  }>;
  contentSummary: string;
}
```

不再使用单一的 `capabilityDelta: high | medium | low` 作为产品结论；等级不能替代具体的删除反事实。

`modelNativeScaffold` 的摘录是 Observed，判断“当前强 coding model 大概率已经具备这项能力”是 Interpretation。该判断必须相对于 `capable-current-coding-agent`，不能写成跨模型、跨时间都成立的客观事实。Gate 不得把 `genericProcedure` 标签本身当作事实证据。

### 2. Capability Aha 必须通过双边证据比较

任何“项目协议比通用流程更值得保留”之类的结论，都必须同时拥有：

- **Unique side**：项目事实、硬约束、专用工具或决策规则的逐字 `SKILL.md` 摘录，并说明强模型无法仅凭常识知道它；
- **Model-native side**：通用流程的逐字摘录，并说明即使移除这部分，强模型大概率仍能完成什么。

双边证据的存在也不等于证据充分。Claim 强度按证据能力递进：

- **coexistence**：至少一条 unique 摘录与一条 model-native 摘录，只能说 Skill 同时包含两类内容；
- **scaffold-interpretation**：unique 摘录、多个互不重复的 generic 摘录，以及 Usage signal 之间存在关系，才可以说部分通用指导可能被模型原生能力覆盖；
- **primary-delta**：除上述条件外，还要有覆盖多个内容段落或 profile 条目的充分 generic 证据，并排除“只有一条通用句子却代表整个 Skill”的跳跃，才可以说长期 Capability Delta 主要集中在专有协议/能力。

只有一侧证据时，洞察必须收窄为受支持的单侧陈述，不能升级为 Capability Aha。`evidenceExcerpt` 最长 200 字符，并继续接受 Snapshot 的确定性逐字校验。

### 3. Candidate、Gate 与 Ranking 分层

确定性层新增 Cross-layer Candidate Generator，但不增加无边界的 taxonomy。第一版只支持：`high_usage_strong_delta`、`high_usage_model_native_scaffold`、`high_usage_task_scoped_content`、`rare_strong_delta`、`family_shared_core` 与现有 `behavior_outlier`。

Usage Aha Gate 继续要求 deterministic observation、meaningful contrast 与 Cognitive/Decision Delta。Capability Aha Gate 另行要求 Usage evidence、Content evidence、Counterfactual 与 Decision Delta；声明“协议而非通用流程”时，Unique side 与 Model-native side 均不可缺失。

最终输出使用类型配额而非单纯分数排序：Validated Capability Aha > Validated Mechanism Aha > Pure Usage Aha > Naming/descriptive observation。最终允许少于上限，不得用第二、第三条相似 Usage Insight 填满卡位；每次必须尝试生成 Capability Aha，若没有可靠内容证据则记录明确原因并降级，不制造结论。

### 4. Family 语义必须由内容确认

名称前缀只能证明 naming family，不能证明 capability family。要生成 `family_shared_core`，至少需要两个成员的 `SKILL.md` 内容证据、共享核心证据与平台/环境差异证据。缺少这些证据时，最多呈现命名家族的 Usage 观察，不能占据 Capability Aha 卡位。

### 5. P1 Trigger Trace 必须等待 P0 真实报告评估

为解释 calls-per-task 离群行为，后续只增加轻量派生结构，不引入 telemetry、Hook 或持久化事件库：

```ts
interface SkillTriggerPattern {
  skillId: string;
  tasksWithSkill: number;
  tasksWithRepeatedAppearance: number;
  appearancesPerTask: number[];
  appearancePositions: number[];
  earlyAppearanceCount: number;
  middleAppearanceCount: number;
  lateAppearanceCount: number;
}
```

位置归一化到 `0..1`，并按 `0..0.33`、`0.33..0.66`、`0.66..1` 划分 early/middle/late。只有序列证据显示跨阶段重复出现时，才允许生成 Mechanism Aha；否则保留“行为异常，触发机制未知”。P1 不阻塞 P0 Capability Aha，也不在 P0 完成后自动进入实现；只有 P0 的真实报告确认 Capability Aha 已经出现、且仍需要解释高频重复行为时，才重新评估是否启动 P1。

### 6. 验收原则

最终验收不再只问“Reveal 是否足够惊讶”，而问：

> 这条 Insight 是否揭示了一个仅靠 Skill 使用表，或只扫一眼 `SKILL.md`，都不容易同时发现的关系？

当选中的 `SKILL.md` 可读时，最终输出必须尝试生成至少一条无法仅凭 Usage metrics 产生的 Capability Aha；若所有内容候选均未通过 Gate，允许只展示 Usage Aha，但必须在 trace/debug 数据中记录没有通过的具体原因。最小 rejection reason 集合为：`missing_unique_capability_evidence`、`missing_model_native_counterevidence`、`insufficient_content_support`、`usage_content_relation_unclear`、`family_content_unavailable`、`duplicate_mental_model_shift`。
