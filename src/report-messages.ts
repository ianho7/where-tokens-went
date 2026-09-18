type CheckOutcome = "pass" | "notice" | "warning";

interface LongSessionMessages {
  headline: (share: string) => string;
  headlinePrefix: string;
  headlineSuffix: string;
  detail: (calls: string, tokens: string) => string;
  detailPrefix: string;
  detailBetween: string;
  detailSuffix: string;
}

interface ToolAmplificationMessages {
  headline: (estimate: string) => string;
  headlinePrefix: string;
  headlineSuffix: string;
  detail: (resultSize: string, characters: string, calls: string) => string;
  detailPrefix: string;
  detailResultSeparator: string;
  detailBetween: string;
  detailCallSuffix: string;
}

interface CountCheckMessages {
  headline: (count: string) => string;
  headlinePrefix: string;
  headlineSuffix: string;
  detail: string;
}

interface ModelConcentrationMessages {
  headline: (model: string, share: string) => string;
  headlinePrefix: string;
  headlineBetween: string;
  headlineSuffix: string;
  detail: (calls: string) => string;
  detailPrefix: string;
  detailSuffix: string;
}

interface CoverageCheckMessages {
  headline: string;
  detail: (skipped: string, partial: string, warnings: string) => string;
  detailPrefix: string;
  detailSkippedSuffix: string;
  detailPartialSuffix: string;
  detailWarningsSuffix: string;
}

interface CheckMessages {
  outcome: Record<CheckOutcome, string>;
  noFinding: string;
  longSession: LongSessionMessages;
  toolAmplification: ToolAmplificationMessages;
  extraCalls: CountCheckMessages;
  modelConcentration: ModelConcentrationMessages;
  pass: {
    headline: string;
    detail: (records: string, files: string) => string;
    detailPrefix: string;
    detailBetween: string;
    detailSuffix: string;
  };
  coverage: CoverageCheckMessages;
}

interface CoverageMessages {
  alertLabel: string;
  clean: string;
  observedCaveat: string;
  withRate: {
    text: (partial: string, sessions: string, rate: string) => string;
    htmlBetween: string;
    htmlSessionPrefix: string;
    htmlRateSuffix: string;
  };
  withoutRate: {
    text: (partial: string) => string;
    htmlSuffix: string;
  };
  skippedOrWarnings: string;
  allPartialSubagents: string;
  composition: {
    text: (topLevel: string, subagent: string) => string;
    htmlPrefix: string;
    htmlBetween: string;
    htmlSuffix: string;
  };
  stats: (files: number, records: number, skipped: number, partial: number, warnings: number) => string;
}

interface HeaderMessages {
  eyebrow: (dateRange: string) => string;
  suffix: string;
  asOf: (date: string) => string;
  apiEquivalent: string;
  keyMetrics: string;
  overviewUnavailable: string;
  overviewEvidence: string;
}

interface KeySessionMessages {
  decisionState: {
    testable: string;
    notRecommended: string;
    unavailable: string;
  };
  noComposition: string;
  roundLabel: (ordinal: string) => string;
  concentrationUnavailable: string;
  concentration: (count: number, percent: string) => string;
  factWithDuration: (concentration: string, round: string, duration: string) => string;
  factWithoutDuration: (concentration: string) => string;
  unavailableReason: (reason?: string) => string;
  support: Record<"strong" | "moderate" | "limited", string>;
  fallbackTaskContext: string;
  deterministicTrajectoryAvailable: string;
  evidenceStrength: (support: string) => string;
  alternativeSeparator: string;
  sessionSummaryAria: string;
  roundUnit: string;
  openByDefault: string;
  collapsed: string;
  rank: (index: number, total: number) => string;
  moduleKicker: (harness: string) => string;
  privacyNote: string;
  listAria: string;
  judgmentNote: string;
  tokenShareLabel: string;
  promptUnavailable: string;
  promptAvailable: (count: number) => string;
  promptMissing: string;
  roundsSummary: (count: number) => string;
  chartRounds: (count: number) => string;
  legendAria: string;
  hotspots: string;
  otherRounds: string;
  chartAria: (count: number) => string;
  focus: string;
  noScript: string;
}

interface ChartMessages {
  unclassified: string;
  cost: string;
  summary: string;
  localTime: string;
  hourlyDetails: string;
  hourlySummary: string;
  hourlyDescription: string;
  hourlyAveragePerCall: string;
  hourlyShare: string;
  hourlyNoActivity: string;
  hourlyNoTokenData: string;
  localObservation: string;
  modelShareAria: string;
  toolAria: string;
  modelAria: string;
  modelShareDescription: string;
  toolDescription: string;
  tokenTrendDescription: string;
  keyShareAxis: string;
  keyTrajectoryDescription: string;
}

export interface ReportMessages {
  intlLocale: string;
  htmlLang: string;
  compactLargeUnit: string | null;
  compactMediumUnit: string | null;
  estimatedPrefix: string;
  exactSeparator: string;
  provenanceSeparator: string;
  methodPrefix: string;
  limitationPrefix: string;
  auditPrefix: string;
  topSession: string;
  modelsHeading: string;
  projectFallback: string;
  unknownModel: string;
  unknownSkill: string;
  otherModel: string;
  otherTool: string;
  pricingNote: string;
  untitledSession: string;
  resultSizeCharactersSuffix: string;
  skillPrefix: string;
  skillEvidenceNote: string;
  cacheCompositionPrefix: string;
  firstRequestMethodNote: string;
  topLevelPrefix: string;
  subagentPrefix: string;
  identityCoveragePrefix: string;
  cacheEfficiencyTitle: string;
  costImpactTitle: string;
  cacheRatioMethodNotePrefix: string;
  firstRequestNote: string;
  cacheMethodPrefix: string;
  firstRequestMethodPrefix: string;
  cacheLimitationsPrefix: string;
  firstRequestLimitationsPrefix: string;
  tool: string;
  skill: string;
  key: string;
  toolCategory: string;
  title: string;
  sectionMarkers: {
    overview: string;
    diagnosis: string;
    patterns: string;
    trace: string;
    caveats: string;
  };
  scope: string;
  coverage: string;
  currentProject: string;
  allProjects: string;
  since: string;
  harness: string;
  files: string;
  records: string;
  skipped: string;
  warnings: string;
  partialSessions: string;
  totalTokens: string;
  sessions: string;
  topLevelSessions: string;
  subagentSessions: string;
  modelCalls: string;
  reportedCost: string;
  time: string;
  dailyUsage: string;
  hourlyActivity: string;
  models: string;
  tools: string;
  toolImpactNote: string;
  sessionsByUsage: string;
  limitations: string;
  provenance: string;
  privacy: string;
  unavailable: string;
  exact: string;
  tokens: string;
  share: string;
  calls: string;
  pairedResults: string;
  errors: string;
  injected: string;
  amplified: string;
  characters: string;
  latestWindowTokens: string;
  historicalPeakTokens: string;
  observedActivity: string;
  localOnly: string;
  providerQuota: string;
  resetTime: string;
  input: string;
  cachedInput: string;
  cacheWrite: string;
  output: string;
  reasoning: string;
  date: string;
  model: string;
  session: string;
  kindLongSession: string;
  kindToolAmplification: string;
  kindExtraCalls: string;
  reported: string;
  derived: string;
  estimated: string;
  unavailableProvenance: string;
  noData: string;
  noTimestampData: string;
  noToolData: string;
  noQuota: string;
  checksNote: string;
  reportSynthesisNote: string;
  reportFallbackNote: string;
  reportFallbackDetail: string;
  findingEvidence: string;
  automatedCheckEvidence: string;
  findingSupport: Record<"strong" | "moderate" | "limited", string>;
  findingUncertainty: string;
  noStrongFinding: string;
  diagnosticSignals: string;
  primaryAnswer: string;
  primaryDestination: string;
  primaryMechanism: string;
  primaryAction: string;
  primaryLimitation: string;
  primaryUnknownMechanism: string;
  primaryNoDestination: string;
  privacyNote: string;
  methodNote: string;
  usageView: string;
  windowView: string;
  toolsView: string;
  reportWritten: string;
  weekView: string;
  currentWeek: string;
  previousWeek: string;
  change: string;
  noComparison: string;
  redactedShare: string;
  cacheEconomics: string;
  cacheReadRate: string;
  cacheWriteRate: string;
  cacheCoverage: string;
  cacheSavings: string;
  cacheSavingsPercent: string;
  observedApiCost: string;
  allUncachedApiCost: string;
  priceCoverage: string;
  firstRequestBurden: string;
  firstRequestMedian: string;
  firstRequestShare: string;
  firstRequestCoverage: string;
  firstRequestCompositionCoverage: string;
  coldFirstRequestRate: string;
  identityCoverage: string;
  skillInsightsTitle: string;
  skillInsightsNote: string;
  skillInsightLabels: {
    observation: string;
    contrast: string;
    interpretation: string;
    consequence: string;
    mechanism: string;
    shiftSurface: string;
    shiftObserved: string;
    claim: string;
    action: string;
    evidence: string;
  };
  skillEvidence: string;
  skillState: string;
  availableSessions: string;
  invocationCount: string;
  skillSessions: string;
  observedFrom: string;
  observedTo: string;
  attributedTokens: string;
  attributedCost: string;
  evidenceCoverage: string;
  directResourceFootprint: string;
  observedAssociation: string;
  causalImpact: string;
  noSkillEvidence: string;
  turn: string;
  activeTime: string;
  evidenceCompleteness: string;
  turnTrajectory: string;
  keySessionAnalysis: string;
  taskContext: string;
  primaryFinding: string;
  evidenceChain: string;
  improvementAction: string;
  verificationMethod: string;
  interpretation: string;
  proposal: string;
  analysisUnavailable: string;
  noStrongEvidence: string;
  roundCount: string;
  totalDuration: string;
  roundDuration: string;
  processEvents: string;
  resultSize: string;
  toolCalls: string;
  sessionToken: string;
  firstUserMessage: string;
  chartHint: string;
  noUserMessage: string;
  allRoundDetails: string;
  detailNote: string;
  moduleDeck: string;
  trajectoryIntro: string;
  noTrajectory: string;
  duration: {
    hour: string;
    minute: string;
    second: string;
    separator: string;
  };
  header: HeaderMessages;
  checks: CheckMessages;
  coverageMessages: CoverageMessages;
  keySession: KeySessionMessages;
  charts: ChartMessages;
  eventLabels: Record<string, string>;
  skillStates: Record<string, string>;
  warning: (warning: string) => string;
  limitation: (limitation: string) => string;
  method: (method?: string) => string;
}

function localizeWarningEnglish(warning: string): string {
  if (warning === "Some Codex Sessions have Turn snapshots that do not reconcile to their per-response Usage; only individually reconciled Sessions are eligible for AI analysis.") {
    return "Some Codex task records cannot currently be reconciled with per-response Token usage; only reconciled tasks are eligible for AI analysis.";
  }
  const unsupported = /^(\d+) Codex Session(?:s)? contain(?:s)? unsupported accounting records; only a partial audit is reported\.$/.exec(warning);
  if (unsupported) return unsupported[1] + " Codex task" + (unsupported[1] === "1" ? "" : "s") + " contain records that could not be parsed; the audit may be partial.";
  const missingTime = /^(\d+) Codex Session(?:s)? contain(?:s)? accounting records without a usable timestamp; only time-scoped records were analysed\.$/.exec(warning);
  if (missingTime) return missingTime[1] + " Codex task" + (missingTime[1] === "1" ? "" : "s") + " contain records without usable timestamps; only records inside the requested time range were analysed.";
  if (warning === "A Codex rollout could not be read and was skipped.") return "A Codex history record could not be read and was skipped.";
  if (warning === "A Claude Code transcript could not be read and was skipped.") return "A Claude Code history record could not be read and was skipped.";
  if (/^No Codex rollout history was found/.test(warning)) return "No Codex history was found in the selected range.";
  if (/^No Claude Code transcript history was found/.test(warning)) return "No Claude Code history was found in the selected range.";
  return /[A-Za-z]/.test(warning) ? "A source record could not be read and was skipped." : warning;
}

function localizeWarningChinese(warning: string): string {
  if (warning === "Some Codex Sessions have Turn snapshots that do not reconcile to their per-response Usage; only individually reconciled Sessions are eligible for AI analysis.") {
    return "部分 Codex 任务的轮次快照与每次模型调用的 Token 记录暂时无法核对；只有已核对的任务才会进入 AI 解读。";
  }
  const unsupported = /^(\d+) Codex Session(?:s)? contain(?:s)? unsupported accounting records; only a partial audit is reported\.$/.exec(warning);
  if (unsupported) return unsupported[1] + " 个 Codex 任务包含暂时无法解析的 Token 记录，数据可能不完整。";
  const missingTime = /^(\d+) Codex Session(?:s)? contain(?:s)? accounting records without a usable timestamp; only time-scoped records were analysed\.$/.exec(warning);
  if (missingTime) return missingTime[1] + " 个 Codex 任务缺少可用时间戳；只统计时间范围明确的记录。";
  if (warning === "A Codex rollout could not be read and was skipped.") return "有一份 Codex 历史记录无法读取，已跳过。";
  if (warning === "A Claude Code transcript could not be read and was skipped.") return "有一份 Claude Code 历史记录无法读取，已跳过。";
  if (/^No Codex rollout history was found/.test(warning)) return "所选范围内没有找到 Codex 历史记录。";
  if (/^No Claude Code transcript history was found/.test(warning)) return "所选范围内没有找到 Claude Code 历史记录。";
  return /[A-Za-z]/.test(warning) ? "有一条数据记录无法读取，已跳过。" : warning;
}

function localizeLimitationChinese(limitation: string): string {
  const exactPrice = /^LiteLLM returned no exact price entry for (.+)$/.exec(limitation);
  if (exactPrice) return "LiteLLM 没有找到 " + exactPrice[1] + " 的精确价格条目";
  const failedPrice = /^LiteLLM price lookup failed for (.+)$/.exec(limitation);
  if (failedPrice) return "LiteLLM 查询 " + failedPrice[1] + " 的价格失败";
  const resolvedPrice = /^no resolved price entry for (.+)$/.exec(limitation);
  if (resolvedPrice) return "没有找到 " + resolvedPrice[1] + " 的价格条目";
  const derivedProvider = /^Provider was derived from the selected Harness for pricing: (.+)$/.exec(limitation);
  if (derivedProvider) return "定价时根据所选 Harness 推断 Provider：" + derivedProvider[1];
  const conflictingProvider = /^Provider did not match the selected Harness: (.+)$/.exec(limitation);
  if (conflictingProvider) return "Provider 与所选 Harness 不匹配：" + conflictingProvider[1];
  if (limitation === "LiteLLM price lookup was not performed") return "尚未执行 LiteLLM 价格查询";
  if (limitation === "cost estimate covers only priced Usage; unpriced or incompatible Usage is excluded") return "成本估算只统计已定价用量；未定价或不兼容的用量不计入";
  if (limitation === "missing compatible price dimension or mutually exclusive Token composition") return "缺少匹配的价格档位，或 Token 分类有重叠，无法直接计价";
  if (limitation === "missing compatible price dimension for a non-zero Token bucket") return "非零 Token 分桶缺少兼容的价格维度";
  if (limitation === "cache-write TTL or cache-write price dimension was unavailable") return "没有可用的缓存写入 TTL 或价格档位";
  if (limitation === "missing exact model identifier") return "缺少精确模型标识";
  if (limitation === "missing Token total") return "缺少 Token 总量";
  if (limitation === "calls with missing or inconsistent Token composition were excluded from cache ratios") return "Token 构成缺失或不一致的调用，不计入缓存比例";
  if (limitation === "cache Token ratios are unavailable because no selected call has compatible composition") return "没有调用提供可匹配的 Token 构成，因此无法计算缓存 Token 比例";
  if (limitation === "selected Token total was incomplete for cache composition coverage") return "所选 Token 总量不完整，因此无法计算缓存构成可分解比例";
  if (limitation === "no ModelCall had a complete mutually exclusive Token composition for cache coverage") return "没有模型调用提供完整且不重叠的 Token 构成，因此无法计算缓存构成可分解比例";
  if (limitation === "no selected Token total was available for price coverage") return "没有可用的所选 Token 总量来计算已定价用量占比";
  if (limitation === "no Token total was available for price coverage") return "没有可用的 Token 总量来计算已定价用量占比";
  if (limitation === "the all-uncached comparison requires at least one selected ModelCall with compatible exact pricing") return "要比较不缓存情况下的成本，至少需要一个价格信息完整且匹配的模型调用";
  if (limitation === "currency requires at least one selected ModelCall with an exact Provider/model match and compatible non-zero price dimensions") return "要计算金额，至少需要一个来源、模型和非零价格档位都精确匹配的模型调用";
  if (limitation === "cache savings requires at least one priced Usage with complete compatible cost dimensions") return "要计算缓存节省，至少需要一条价格信息完整且匹配的已定价用量";
  if (limitation === "cache savings percentage requires at least one priced Usage with complete compatible cost dimensions") return "要计算缓存节省比例，至少需要一条价格信息完整且匹配的已定价用量";
  if (limitation === "cost difference requires at least one priced Usage with complete compatible cost dimensions") return "要计算成本差额，至少需要一条价格信息完整且匹配的已定价用量";
  if (limitation === "cost difference percentage requires at least one priced Usage with complete compatible cost dimensions") return "要计算成本差额比例，至少需要一条价格信息完整且匹配的已定价用量";
  if (limitation === "首次请求负担 is an observed earliest request size, not an exact removable startup tax") return "首次请求 Token 量是观测到的最早请求大小，不是可以精确剥离的启动成本";
  if (limitation === "Sessions without a timestamped valid ModelCall are excluded from first-request coverage") return "没有有效时间戳的任务，不计入首次请求完整度";
  if (limitation === "first-request cache composition is partial because some earliest calls are missing compatible Token fields") return "部分最早请求缺少兼容 Token 字段，因此首次请求缓存构成不完整";
  if (limitation === "first-request coverage has no selected Session denominator") return "没有所选任务作为首次请求完整度的分母";
  if (limitation === "top-level versus Subagent first-request groups require source-proven identity for every selected Session") return "要比较顶层和子任务的首次请求，必须确认每个所选任务的身份";
  if (limitation === "no selected Sessions were available for top-level or Subagent identity coverage") return "没有可用于确认顶层或子任务身份的所选任务";
  if (limitation === "causal Skill impact requires a valid comparison or counterfactual, which local history does not provide") return "无法验证 Skill 与结果之间的因果关系：本地历史没有提供有效对照数据";
  const missingSkillAssociation = /^no source-proven ModelCall association was available for (.+)$/.exec(limitation);
  if (missingSkillAssociation) return "没有足够证据把模型调用关联到：" + missingSkillAssociation[1];
  if (limitation === "no source-proven ModelCall association was available") return "没有足够证据把模型调用关联到对应 Skill";
  if (limitation === "no Skill evidence was available") return "没有可用的 Skill 证据";
  return "存在一项未满足的诊断条件";
}

function localizeMethodChinese(method: string | undefined): string {
  if (!method) return "无数据";
  const exact: Record<string, string> = {
    "cache-read Token count numerator divided by denominator, expressed as percentage points and rounded to two decimals": "缓存读取 Token 总量除以分母，换算为百分比并四舍五入到两位小数",
    "cache-write Token count numerator divided by denominator, expressed as percentage points and rounded to two decimals": "缓存写入 Token 总量除以分母，换算为百分比并四舍五入到两位小数",
    "median of earliest valid ModelCall Token totals in selected": "取所选任务中每个最早有效模型调用的 Token 总量中位数",
    "largest paired tool-result estimate is greater than zero": "最大的一次工具结果，后续被再次带入上下文",
    "count of observed retry, interruption, and subagent lifecycle records is greater than zero": "观测到的重试、中断和子任务启停记录数量大于零",
    "largest complete Session share is at least 40% with at least two ModelCall records": "至少有两个模型调用记录时，最大完整任务占比至少为 40%",
    "largest complete model contribution share is at least 60% when more than one model is observed": "观测到多个模型时，最大完整模型贡献占比至少为 60%",
    "coverage reports skipped records, partial Sessions, or warnings": "数据中有跳过记录、不完整任务或异常",
    "coverage reports at least one record with no skipped records, partial Sessions, or warnings": "至少有一条记录，且没有跳过记录、不完整任务或异常",
  };
  if (exact[method]) return exact[method];
  if (method.includes("Provider and model match against the LiteLLM model catalog")) {
    return method.startsWith("partial")
      ? "根据 LiteLLM 模型目录和 Harness 到 Provider 的映射，对已定价用量按 API 单价折算；未定价或不兼容的用量不计入；普通输入、缓存读取、缓存写入和输出分别计价，分类之间不重叠"
      : "根据 LiteLLM 模型目录和 Harness 到 Provider 的映射精确匹配 Provider 与模型；普通输入、缓存读取、缓存写入和输出分别计价，分类之间不重叠";
  }
  if (method.startsWith("partial all-uncached counterfactual")) return "按已定价用量计算“假设不缓存”的成本：普通输入、缓存读取和缓存写入按普通输入价格计价，输出价格不变；未定价用量不计入";
  if (method.startsWith("all-uncached counterfactual")) return "“不缓存情况下的成本”把普通输入、缓存读取和缓存写入按普通输入价格计价，输出价格不变";
  if (method.startsWith("all-uncached API-equivalent estimate minus observed API-equivalent estimate")) return "不缓存情况下的 API 折算金额减去已观测的 API 折算金额；正值表示缓存降低了估算金额";
  if (method.startsWith("cache savings divided by all-uncached API-equivalent cost")) return "估算节省金额除以不缓存情况下的 API 折算金额，换算为百分比并四舍五入到两位小数";
  if (method.startsWith("cost difference divided by all-uncached API-equivalent estimate")) return "成本差额除以不缓存情况下的 API 折算金额，换算为百分比并四舍五入到两位小数";
  if (method.startsWith("sum of compatible ")) return method.replace(/^sum of compatible (.+) Token buckets$/, "把兼容的 $1 Token 分桶相加");
  if (method.startsWith("median of earliest valid ModelCall Token totals in ")) return method.replace(/^median of earliest valid ModelCall Token totals in (.+)$/, "取 $1 中每个最早有效模型调用的 Token 总量中位数");
  return "按所选历史记录和支持字段计算";
}

function localizeLimitationEnglish(limitation: string): string {
  const exact: Record<string, string> = {
    "首次请求负担 is an observed earliest request size, not an exact removable startup tax": "First-request usage is an observed earliest request size, not an exact removable startup cost.",
    "Sessions without a timestamped valid ModelCall are excluded from first-request coverage": "Task records without a timestamped valid model call are excluded from first-request coverage.",
    "first-request coverage has no selected Session denominator": "No selected task records are available as the first-request coverage denominator.",
    "top-level versus Subagent first-request groups require source-proven identity for every selected Session": "Comparing top-level and subagent task groups requires source-proven identity for every selected task.",
    "no selected Sessions were available for top-level or Subagent identity coverage": "No selected task records were available for top-level or subagent identity coverage.",
    "no ModelCall had a complete mutually exclusive Token composition for cache coverage": "No model call had a complete, non-overlapping Token composition for cache coverage.",
    "the all-uncached comparison requires at least one selected ModelCall with compatible exact pricing": "The all-uncached comparison requires at least one selected model call with compatible exact pricing.",
    "currency requires at least one selected ModelCall with an exact Provider/model match and compatible non-zero price dimensions": "Currency requires at least one selected model call with an exact source/model match and compatible non-zero price dimensions.",
    "no source-proven ModelCall association was available": "There is not enough evidence to associate model calls with the Skill.",
  };
  if (exact[limitation]) return exact[limitation];
  const missingSkillAssociation = /^no source-proven ModelCall association was available for (.+)$/.exec(limitation);
  if (missingSkillAssociation) return "There is not enough evidence to associate model calls with " + missingSkillAssociation[1] + ".";
  return limitation
    .replace(/\bSessions\b/gu, "task records")
    .replace(/\bSession\b/gu, "task record")
    .replace(/\bModelCalls\b/gu, "model calls")
    .replace(/\bModelCall\b/gu, "model call")
    .replace(/\bTurns\b/gu, "rounds")
    .replace(/\bTurn\b/gu, "round")
    .replace(/\bSubagent\b/gu, "subagent");
}

function localizeMethodEnglish(method: string | undefined): string {
  if (!method) return "unavailable";
  const exact: Record<string, string> = {
    "cache-read Token count numerator divided by denominator, expressed as percentage points and rounded to two decimals": "Cache-read Token total divided by its denominator and rounded to two decimals.",
    "cache-write Token count numerator divided by denominator, expressed as percentage points and rounded to two decimals": "Cache-write Token total divided by its denominator and rounded to two decimals.",
    "median of earliest valid ModelCall Token totals in selected": "Median Token total of the earliest valid model call in each selected task.",
    "largest paired tool-result estimate is greater than zero": "The largest paired tool result is a possible carry-forward source.",
    "count of observed retry, interruption, and subagent lifecycle records is greater than zero": "At least one retry, interruption, or subagent lifecycle record was observed.",
    "largest complete Session share is at least 40% with at least two ModelCall records": "The largest complete task accounts for at least 40% with at least two model-call records.",
    "largest complete model contribution share is at least 60% when more than one model is observed": "The largest complete model contribution accounts for at least 60% when more than one model is observed.",
    "coverage reports skipped records, partial Sessions, or warnings": "Coverage reports skipped records, partial task records, or warnings.",
    "coverage reports at least one record with no skipped records, partial Sessions, or warnings": "At least one record was observed with no skipped records, partial task records, or warnings.",
  };
  if (exact[method]) return exact[method];
  if (method.includes("Provider and model match against the LiteLLM model catalog")) {
    return method.startsWith("partial")
      ? "API-equivalent usage is estimated only for records with an exact source/model price match; unpriced or incompatible usage is excluded."
      : "Source and model are matched against the LiteLLM catalog; ordinary input, cache reads, cache writes, and output are priced separately.";
  }
  if (method.startsWith("partial all-uncached counterfactual")) return "The all-uncached estimate prices ordinary input, cache reads, and cache writes as ordinary input; output pricing is unchanged and unpriced usage is excluded.";
  if (method.startsWith("all-uncached counterfactual")) return "The all-uncached estimate prices ordinary input, cache reads, and cache writes as ordinary input; output pricing is unchanged.";
  if (method.startsWith("all-uncached API-equivalent estimate minus observed API-equivalent estimate")) return "All-uncached API-equivalent estimate minus observed API-equivalent estimate; a positive value indicates lower estimated cost with caching.";
  if (method.startsWith("cache savings divided by all-uncached API-equivalent cost")) return "Estimated savings divided by the all-uncached API-equivalent estimate and rounded to two decimals.";
  if (method.startsWith("cost difference divided by all-uncached API-equivalent estimate")) return "Cost difference divided by the all-uncached API-equivalent estimate and rounded to two decimals.";
  if (method.startsWith("sum of compatible ")) return method.replace(/^sum of compatible (.+) Token buckets$/, "Sum of compatible $1 Token buckets.");
  if (method.startsWith("median of earliest valid ModelCall Token totals in ")) return method.replace(/^median of earliest valid ModelCall Token totals in (.+)$/, "Median Token total of the earliest valid model call in each $1.");
  return localizeLimitationEnglish(method);
}

const EN: ReportMessages = {
  intlLocale: "en-US-u-nu-latn",
  htmlLang: "en",
  compactLargeUnit: null,
  compactMediumUnit: null,
  estimatedPrefix: "about ",
  exactSeparator: ": ",
  provenanceSeparator: "; ",
  methodPrefix: "Method: ",
  limitationPrefix: "Limitations: ",
  auditPrefix: "Usage: ",
  topSession: "Largest task",
  modelsHeading: "Models",
  projectFallback: "project",
  unknownModel: "Unknown model",
  unknownSkill: "Unknown Skill",
  otherModel: "other-model",
  otherTool: "other-tool",
  pricingNote: "Amounts use only usage with an exact price match; some models remain unmatched, so the estimate may understate the cost of the full observed usage.",
  untitledSession: "Untitled task",
  resultSizeCharactersSuffix: " chars",
  skillPrefix: "Skill: ",
  skillEvidenceNote: "API-equivalent cost here includes only usage explicitly attributable to the Skill; local history cannot prove that a Skill caused extra cost.",
  cacheCompositionPrefix: "Cache composition: ordinary input ",
  firstRequestMethodNote: "This is the observed earliest request size; it cannot precisely decompose system, Skill, or user-input overhead.",
  topLevelPrefix: "Top-level tasks: ",
  subagentPrefix: "Subagent tasks: ",
  identityCoveragePrefix: "Task identity coverage: ",
  cacheEfficiencyTitle: "Cache efficiency",
  costImpactTitle: "Cost impact",
  cacheRatioMethodNotePrefix: "Cache ratios sum mutually exclusive Token buckets before division; currency is an API-equivalent estimate, not a subscription bill. Method: ",
  firstRequestNote: "This is the observed burden in Tokens of each task's earliest valid request, not an exact decomposable startup tax.",
  cacheMethodPrefix: "Cache method: ",
  firstRequestMethodPrefix: "First-request method: ",
  cacheLimitationsPrefix: "Cache limitations: ",
  firstRequestLimitationsPrefix: "First-request limitations: ",
  tool: "Tool",
  skill: "Skill",
  key: "Key",
  toolCategory: "Tool category",
  title: "where-tokens-went diagnostic report",
  sectionMarkers: {
    overview: "01 · Orient",
    diagnosis: "02 · Diagnose",
    patterns: "03 · Patterns",
    trace: "04 · Trace",
    caveats: "05 · Caveats",
  },
  scope: "Usage scope",
  coverage: "Data completeness",
  currentProject: "current project",
  allProjects: "all projects",
  since: "since",
  harness: "Harness",
  files: "files",
  records: "records",
  skipped: "skipped",
  warnings: "coverage warnings",
  partialSessions: "partial tasks",
  totalTokens: "total tokens",
  sessions: "tasks",
  topLevelSessions: "top-level tasks",
  subagentSessions: "subagent tasks",
  modelCalls: "model calls",
  reportedCost: "reported cost",
  time: "Time distribution",
  dailyUsage: "Daily token trend",
  hourlyActivity: "Hourly activity heatmap",
  models: "Model distribution",
  tools: "Tool context impact",
  toolImpactNote: "The injected estimate is the tool-result size added to context; the carry-forward estimate is an uncapped exposure heuristic for how much it may be carried by later calls in the same active context. It is not a bill, actual new Token usage, or additive to total tokens.",
  sessionsByUsage: "Largest tasks by Token use",
  limitations: "Limitations and missing data",
  provenance: "Provenance",
  privacy: "Privacy and methods",
  unavailable: "unavailable",
  exact: "exact value",
  tokens: "tokens",
  share: "share",
  calls: "calls",
  pairedResults: "paired results",
  errors: "errors",
  injected: "injected estimate",
  amplified: "carry-forward estimate (uncapped)",
  characters: "characters",
  latestWindowTokens: "Latest 5h tokens",
  historicalPeakTokens: "Highest rolling 5h in selected range",
  observedActivity: "Locally observed rolling activity",
  localOnly: "This is activity observed in local history, not Provider quota.",
  providerQuota: "Provider quota",
  resetTime: "reset time",
  input: "ordinary input",
  cachedInput: "cached input",
  cacheWrite: "cache write",
  output: "output",
  reasoning: "reasoning",
  date: "date",
  model: "model",
  session: "task",
  kindLongSession: "long task",
  kindToolAmplification: "tool context amplification",
  kindExtraCalls: "extra calls",
  reported: "reported",
  derived: "derived",
  estimated: "estimated",
  unavailableProvenance: "unavailable",
  noData: "No data is available for this panel.",
  noTimestampData: "There are not enough usable timestamps for hourly or rolling activity.",
  noToolData: "No paired tool results are available for tool impact.",
  noQuota: "No first-party quota data is available from this Harness.",
  checksNote: "These deterministic checks are supporting evidence; they do not replace the report's direct explanation.",
  reportSynthesisNote: "This explanation is generated from the current sanitized usage record; deterministic checks remain supporting evidence.",
  reportFallbackNote: "A direct explanation was unavailable or could not be verified; the following deterministic checks are shown as fallback evidence.",
  reportFallbackDetail: "The report remains usable, but this section is limited to deterministic evidence.",
  findingEvidence: "Evidence",
  automatedCheckEvidence: "Automated Check evidence",
  findingSupport: { strong: "Strong support", moderate: "Moderate support", limited: "Limited support" },
  findingUncertainty: "Uncertainty",
  noStrongFinding: "No strong Finding is supported by this Audit",
  diagnosticSignals: "Findings",
  primaryAnswer: "Primary answer",
  primaryDestination: "Largest Token destination",
  primaryMechanism: "Supported mechanism",
  primaryAction: "Next action",
  primaryLimitation: "Confidence limit",
  primaryUnknownMechanism: "No specific mechanism is supported by the available task and round evidence.",
  primaryNoDestination: "No valid Token destination is available in this report.",
  privacyNote: "The report keeps safe metadata, sizes, hashes, aggregates, and methods; it excludes prompts, source, responses, tool results, arguments, credentials, and absolute paths.",
  methodNote: "Estimated values are for reference only and do not represent an actual bill; “—” means data is unavailable.",
  usageView: "Usage overview",
  windowView: "Rolling window",
  toolsView: "Tool analysis",
  reportWritten: "Local HTML report generated.",
  weekView: "Current and previous week",
  currentWeek: "current week",
  previousWeek: "previous week",
  change: "change",
  noComparison: "There is not enough complete data for a week comparison.",
  redactedShare: "Redacted share",
  cacheEconomics: "Cache economics",
  cacheReadRate: "cache-read rate",
  cacheWriteRate: "cache-write rate",
  cacheCoverage: "cache composition coverage",
  cacheSavings: "estimated cache savings",
  cacheSavingsPercent: "estimated cache savings percentage",
  observedApiCost: "observed API-equivalent cost",
  allUncachedApiCost: "all-uncached counterfactual cost",
  priceCoverage: "priced Usage coverage",
  firstRequestBurden: "First-request burden",
  firstRequestMedian: "median first request (Tokens)",
  firstRequestShare: "first-request Usage share",
  firstRequestCoverage: "first-request coverage",
  firstRequestCompositionCoverage: "first-request composition coverage",
  coldFirstRequestRate: "cold first-request rate",
  identityCoverage: "task identity coverage",
  skillInsightsTitle: "Skill Insights",
  skillInsightsNote: "Evidence-backed patterns derived from usage and selected SKILL.md content; focused on capability delta and workflow core.",
  skillInsightLabels: {
    observation: "Observation",
    contrast: "Contrast Baseline",
    interpretation: "Why It Matters",
    consequence: "Suggested Action",
    mechanism: "Conditional Mechanism",
    shiftSurface: "Surface Assumption",
    shiftObserved: "Observed Reality",
    claim: "Core Finding",
    action: "Suggested Action",
    evidence: "Key Evidence",
  },
  skillEvidence: "Skill evidence",
  skillState: "state",
  availableSessions: "available tasks",
  invocationCount: "invocations",
  skillSessions: "invocation tasks",
  observedFrom: "first observed",
  observedTo: "last observed",
  attributedTokens: "attributed tokens",
  attributedCost: "attributed API cost",
  evidenceCoverage: "Evidence coverage",
  directResourceFootprint: "direct resource evidence",
  observedAssociation: "associated model calls",
  causalImpact: "causal impact",
  noSkillEvidence: "The selected history has no verifiable Skill listing, invocation, or resource-use evidence.",
  turn: "Rounds",
  activeTime: "round duration",
  evidenceCompleteness: "Data completeness",
  turnTrajectory: "Round Token trajectory",
  keySessionAnalysis: "Key task analysis",
  taskContext: "Task context",
  primaryFinding: "Core judgment",
  evidenceChain: "Evidence chain",
  improvementAction: "Improvement proposal",
  verificationMethod: "How to verify",
  interpretation: "Mechanism explanation",
  proposal: "Improvement proposal",
  analysisUnavailable: "Key task analysis unavailable: ",
  noStrongEvidence: "No Evidence supports a strong primary problem.",
  roundCount: "rounds",
  totalDuration: "total duration",
  roundDuration: "round duration",
  processEvents: "process events",
  resultSize: "result size",
  toolCalls: "tool calls",
  sessionToken: "Task Tokens",
  firstUserMessage: "first real user message",
  chartHint: "Click or hover a point to inspect the complete real Prompt",
  noUserMessage: "No independent user message was recorded for this round",
  allRoundDetails: "View all",
  detailNote: "Audit appendix · collapsed by default · missing values remain —",
  moduleDeck: "Enter one task from the Token ranking and follow concentration, process events, and real user messages by round.",
  trajectoryIntro: "Bars show Token share and the line shows round duration. Dark points mark hotspots; the same Tooltip gives evidence first, then the round's first real user message.",
  noTrajectory: "No round Evidence is available.",
  duration: { hour: "h", minute: "m", second: "s", separator: " " },
   header: {
     eyebrow: (dateRange) => dateRange + " PROJECT DIAGNOSTIC",
     suffix: "diagnostic report",
     asOf: (date) => "As of " + date,
     apiEquivalent: "API equivalent",
     keyMetrics: "Report key metrics",
     overviewUnavailable: "AI overview unavailable",
     overviewEvidence: "Overview Evidence",
   },
  checks: {
    outcome: { warning: "Warning", notice: "Notice", pass: "Pass" },
    noFinding: "No automated finding is supported by the available evidence.",
    longSession: {
      headline: (share) => "One task accounts for " + share + " of observed tokens",
      headlinePrefix: "One task accounts for ",
      headlineSuffix: " of observed tokens",
      detail: (calls, tokens) => calls + " model-call records; " + tokens + " observed tokens.",
      detailPrefix: "",
      detailBetween: " model-call records; ",
      detailSuffix: " observed tokens.",
    },
    toolAmplification: {
      headline: (estimate) => "One tool result may be carried forward; exposure estimate " + estimate,
      headlinePrefix: "One tool result may be carried forward; exposure estimate ",
      headlineSuffix: "",
      detail: (resultSize, characters, calls) => "Paired result: " + resultSize + " " + characters + "; later model-call records: " + calls + ".",
      detailPrefix: "Paired result: ",
      detailResultSeparator: " ",
      detailBetween: "; later model-call records: ",
      detailCallSuffix: ".",
    },
    extraCalls: {
      headline: (count) => count + " retry, interruption, or subagent lifecycle records observed",
      headlinePrefix: "",
      headlineSuffix: " retry, interruption, or subagent lifecycle records observed",
      detail: "This check counts only observed lifecycle records.",
    },
    modelConcentration: {
      headline: (model, share) => model + " accounts for " + share + " of observed tokens",
      headlinePrefix: "",
      headlineBetween: " accounts for ",
      headlineSuffix: " of observed tokens",
      detail: (calls) => calls + " model-call records.",
      detailPrefix: "",
      detailSuffix: " model-call records.",
    },
    pass: {
      headline: "History parsed without coverage warnings",
      detail: (records, files) => records + " records from " + files + " files; no skipped or partial tasks.",
      detailPrefix: "",
      detailBetween: " records from ",
      detailSuffix: " files; no skipped or partial tasks.",
    },
    coverage: {
      headline: "Coverage reports skipped, partial, or warning records",
      detail: (skipped, partial, warnings) => skipped + " skipped records; " + partial + " partial tasks; " + warnings + " coverage warnings.",
      detailPrefix: "",
      detailSkippedSuffix: " skipped records; ",
      detailPartialSuffix: " partial tasks; ",
      detailWarningsSuffix: " coverage warnings.",
    },
  },
  coverageMessages: {
    alertLabel: "Coverage note",
    clean: "History parsed without coverage warnings.",
    observedCaveat: "Total tokens are the sum of observed, supported records; incomplete coverage may undercount actual usage.",
    withRate: {
      text: (partial, sessions, rate) => partial + " of " + sessions + " tasks (" + rate + ") are partial.",
      htmlBetween: " of ",
      htmlSessionPrefix: " tasks (",
      htmlRateSuffix: ") are partial.",
    },
    withoutRate: {
      text: (partial) => partial + " partial tasks; task composition is unavailable because the source cannot prove the overlap.",
      htmlSuffix: " partial tasks; task composition is unavailable because the source cannot prove the overlap.",
    },
    skippedOrWarnings: "Coverage includes skipped records or warnings;",
    allPartialSubagents: " All partial tasks are source-proven subagent tasks.",
    composition: {
      text: (topLevel, subagent) => " Source-proven partial task composition: " + topLevel + " top-level; " + subagent + " subagent.",
      htmlPrefix: " Source-proven partial task composition: ",
      htmlBetween: " top-level; ",
      htmlSuffix: " subagent.",
    },
    stats: (files, records, skipped, partial, warnings) => files + " files, " + records + " records, " + skipped + " skipped, " + partial + " partial tasks, " + warnings + " coverage warnings.",
  },
  keySession: {
    decisionState: {
      testable: "Worth trying",
      notRecommended: "Not recommended",
      unavailable: "Unavailable",
    },
    noComposition: "No verified task explanation was provided.",
    roundLabel: (ordinal) => "Round " + ordinal,
    concentrationUnavailable: "Top 5 round share is unavailable",
    concentration: (count, percent) => "Top " + count + " rounds account for " + percent,
    factWithDuration: (concentration, round, duration) => concentration + "." + round + " has a round duration of " + duration + ".",
    factWithoutDuration: (concentration) => concentration + ".",
    unavailableReason: (reason) => {
      if (!reason) return "No valid structured analysis was returned.";
      if (reason.includes("did not provide Key Session Analysis")) return "No verified task explanation was generated.";
      if (reason.includes("duplicate Session analysis prose")) return "The same explanation was duplicated across tasks; the deterministic trajectory remains.";
      if (reason.includes("Codex Token accounting")) return "The task's Token records could not be reconciled.";
      if (reason.includes("Audit fingerprint")) return "The explanation does not match the current usage record.";
      if (reason.includes("Turn outside")) return "The explanation refers to a round outside this task.";
      if (reason.includes("primaryFinding")) return "The core judgment did not pass the evidence check.";
      if (reason.includes("recommendation")) return "The proposed action did not pass the evidence check.";
      if (reason.includes("evidenceRead")) return "The explanation does not identify the rounds it used.";
      return "The task explanation could not be verified.";
    },
    support: { strong: "strong", moderate: "moderate", limited: "limited" },
    fallbackTaskContext: "A task explanation is unavailable; the deterministic trajectory remains.",
    deterministicTrajectoryAvailable: "The deterministic round trajectory remains available.",
    evidenceStrength: (support) => "Evidence strength · " + support,
    alternativeSeparator: " ",
    sessionSummaryAria: "Task summary",
    roundUnit: "rounds",
    openByDefault: "open by default",
    collapsed: "collapsed",
    rank: (index, total) => "TOKEN rank " + String(index).padStart(2, "0") + " of " + String(total).padStart(2, "0") + " · Current task",
    moduleKicker: (harness) => "Usage diagnosis · " + harness,
    privacyNote: "Local full HTML Tooltips may include the complete first user message for displayed rounds; share, JSON, and text outputs exclude Prompts.",
    listAria: "Key task list",
    judgmentNote: "State the evidence-backed judgment first, then separate the improvement proposal and verification.",
    tokenShareLabel: "Top 5 round Token share",
    promptUnavailable: "The first user message content is unavailable",
    promptAvailable: (count) => "Local Tooltips include the complete first user message for " + count + " rounds.",
    promptMissing: "Missing first user messages remain explicitly unavailable.",
    roundsSummary: (count) => "View all " + count + " round details",
    chartRounds: (count) => count + " rounds · Token share and round duration",
    legendAria: "Legend",
    hotspots: "Token hotspots",
    otherRounds: "Other rounds",
    chartAria: (count) => count + " rounds of Token share and round duration",
    focus: "Focus: ",
    noScript: "The chart needs JavaScript; expand the complete round details below for the equivalent data.",
  },
  charts: {
    unclassified: "unclassified remainder",
    cost: "API-equivalent estimate (USD)",
    summary: "Each curve and hover value is the raw Token value of that component; components are not stacked.",
    localTime: "Local time",
    hourlyDetails: "View hourly details ↓",
    hourlySummary: "Cell color reflects observed Tokens in each local hour; hover to inspect Tokens, model calls, audit share, and average Tokens per call.",
    hourlyDescription: "Hourly activity by local date and hour; hover each cell to inspect observed Tokens, model calls, audit share, and average Tokens per call. The table below provides equivalent data.",
    hourlyAveragePerCall: "Avg Tokens / call (derived)",
    hourlyShare: "Share of audit period",
    hourlyNoActivity: "No model call observed in this hour.",
    hourlyNoTokenData: "Token total unavailable for this hour.",
    localObservation: "Local observation",
    modelShareAria: "Token share by model",
    toolAria: "Estimated tool-result injection by tool",
    modelAria: "Token distribution by model; the table below provides equivalent data.",
    modelShareDescription: "Token share by model; hover to inspect exact Tokens and share.",
    toolDescription: "Estimated tool-result injection by tool; the table below provides equivalent data.",
    tokenTrendDescription: "Each curve and hover value is the raw Token value of that component; components are not stacked.",
    keyShareAxis: "Token share",
    keyTrajectoryDescription: "Token share and round duration by round; the Tooltip includes the complete first user message.",
  },
   eventLabels: { retry: "retry", compaction: "automatic context compaction", subagent: "Subagent", interrupted: "interrupted" },
  skillStates: { available: "available", invoked: "invoked", attributed: "attributed", unavailable: "unavailable" },
  warning: localizeWarningEnglish,
  limitation: localizeLimitationEnglish,
  method: localizeMethodEnglish,
};

const ZH: ReportMessages = {
  intlLocale: "zh-CN-u-nu-latn",
  htmlLang: "zh-CN",
  compactLargeUnit: "亿",
  compactMediumUnit: "万",
  estimatedPrefix: "约 ",
  exactSeparator: "：",
  provenanceSeparator: "；",
  methodPrefix: "方法：",
  limitationPrefix: "限制：",
  auditPrefix: "审计：",
  topSession: "主要任务",
  modelsHeading: "模型分布",
  projectFallback: "project",
  unknownModel: "未知模型",
  unknownSkill: "未知 Skill",
  otherModel: "other-model",
  otherTool: "other-tool",
  pricingNote: "金额仅按能匹配精确单价的用量估算；仍有部分模型无法匹配价格，因此金额可能低于完整用量对应成本。",
  untitledSession: "未命名任务",
  resultSizeCharactersSuffix: " 字符",
  skillPrefix: "Skill: ",
  skillEvidenceNote: "这里的 API 折算金额只统计能够明确关联到该 Skill 的用量；本地历史无法证明 Skill 导致额外成本。",
  cacheCompositionPrefix: "缓存构成：普通输入 ",
  firstRequestMethodNote: "这是观测到的最早请求大小，无法精确区分系统、Skill 和用户输入各自占了多少。",
  topLevelPrefix: "顶层任务：",
  subagentPrefix: "子任务：",
  identityCoveragePrefix: "任务身份可信度：",
  cacheEfficiencyTitle: "缓存效率",
  costImpactTitle: "成本影响",
  cacheRatioMethodNotePrefix: "缓存比例的算法：先把各类 Token 分别汇总，再计算比例；金额按 API 单价折算，只作估算，不是订阅账单。方法：",
  firstRequestNote: "这是每个任务最早有效请求的 Token 量，不是可以精确剥离的启动成本。",
  cacheMethodPrefix: "缓存方法：",
  firstRequestMethodPrefix: "首次请求方法：",
  cacheLimitationsPrefix: "缓存限制：",
  firstRequestLimitationsPrefix: "首次请求限制：",
  tool: "工具",
  skill: "Skill",
  key: "键",
  toolCategory: "工具类别",
  title: "where-tokens-went 诊断报告",
  sectionMarkers: {
    overview: "01 · 概览",
    diagnosis: "02 · 诊断",
    patterns: "03 · 模式",
    trace: "04 · 追踪",
    caveats: "05 · 限制",
  },
  scope: "本次统计范围",
  coverage: "数据完整度",
  currentProject: "当前项目",
  allProjects: "所有项目",
  since: "起始时间",
  harness: "数据来源",
  files: "文件",
  records: "记录",
  skipped: "跳过",
  warnings: "覆盖异常·警告级",
  partialSessions: "不完整任务记录",
  totalTokens: "总 Token",
  sessions: "任务记录",
  topLevelSessions: "顶层任务",
  subagentSessions: "子任务记录",
  modelCalls: "模型调用",
  reportedCost: "记录成本",
  time: "时间分布",
  dailyUsage: "每日 Token 趋势",
  hourlyActivity: "小时活动热图",
  models: "模型分布",
  tools: "工具上下文影响",
  toolImpactNote: "注入估算表示工具结果被算入上下文的大小；后续暴露估算（无上限）表示同一段对话中，后续调用可能再次带上的上下文量。这个估算不是账单，也不是真实新增 Token，不能与总 Token 相加。",
  sessionsByUsage: "高用量任务记录",
  limitations: "限制与缺失",
  provenance: "证据来源",
  privacy: "隐私说明与统计方法",
  unavailable: "无数据",
  exact: "精确值",
  tokens: "Token",
  share: "占比",
  calls: "调用",
  pairedResults: "配对结果",
  errors: "错误",
  injected: "工具结果注入量（估算）",
  amplified: "后续暴露估算（无上限）",
  characters: "字符",
  latestWindowTokens: "最近 5 小时 Token",
  historicalPeakTokens: "所选范围内最高滚动 5 小时 Token",
  observedActivity: "最近一段时间的本地活动",
  localOnly: "只表示本地历史中观察到的活动，不是该工具官方提供的额度。",
  providerQuota: "Provider 额度",
  resetTime: "重置时间",
  input: "普通输入",
  cachedInput: "缓存读取",
  cacheWrite: "缓存写入",
  output: "输出",
  reasoning: "推理",
  date: "日期",
  model: "模型",
  session: "任务记录",
  kindLongSession: "长任务",
  kindToolAmplification: "工具结果后续暴露",
  kindExtraCalls: "额外调用",
  reported: "记录值",
  derived: "计算值",
  estimated: "估算值",
  unavailableProvenance: "无数据",
  noData: "没有可展示的数据。",
  noTimestampData: "可用时间戳不足，无法显示小时和最近一段时间的活动。",
  noToolData: "没有找到可配对的工具结果，无法分析工具影响。",
  noQuota: "没有该工具官方提供的额度数据。",
  checksNote: "这些确定性检查只作支持证据，不替代报告的直接解释。",
  reportSynthesisNote: "以下解释根据本次脱敏用量记录生成；确定性检查只作支持证据。",
  reportFallbackNote: "直接解释不可用或未通过核对；以下展示确定性检查作为降级证据。",
  reportFallbackDetail: "报告其他部分仍可使用，但这一节只保留确定性证据。",
  findingEvidence: "证据",
  automatedCheckEvidence: "自动检查证据",
  findingSupport: { strong: "强支持", moderate: "中等支持", limited: "有限支持" },
  findingUncertainty: "不确定性",
  noStrongFinding: "本次审计没有足够证据支持强发现",
  diagnosticSignals: "补充发现",
  primaryAnswer: "主要答案",
  primaryDestination: "最大 Token 去向",
  primaryMechanism: "证据支持的机制",
  primaryAction: "下一步行动",
  primaryLimitation: "会改变判断的数据限制",
  primaryUnknownMechanism: "具体机制未知：现有任务和轮次证据不足，无法确认是上下文重复、工具结果、重试还是其他机制。",
  primaryNoDestination: "本次统计没有可确认的有效 Token 去向。",
  privacyNote: "报告只保留脱敏后的元数据、大小、哈希、聚合结果和计算方法；不包含 prompt、源代码、回复、工具结果、参数、凭据或绝对路径。",
  methodNote: "估算值仅作参考，不代表实际账单；“—”表示暂时没有数据。",
  usageView: "用量概览",
  windowView: "滚动窗口",
  toolsView: "工具分析",
  reportWritten: "本地 HTML 报告生成完成。",
  weekView: "本周与上周",
  currentWeek: "本周",
  previousWeek: "上周",
  change: "变化",
  noComparison: "完整数据不足，无法进行周对比。",
  redactedShare: "脱敏分享稿",
  cacheEconomics: "缓存经济性",
  cacheReadRate: "缓存读取率",
  cacheWriteRate: "缓存写入率",
  cacheCoverage: "缓存构成可分解比例",
  cacheSavings: "缓存带来的估算节省",
  cacheSavingsPercent: "估算节省比例",
  observedApiCost: "已观测的 API 折算金额",
  allUncachedApiCost: "不缓存情况下的 API 折算金额",
  priceCoverage: "已定价用量占比",
  firstRequestBurden: "首次请求 Token 量",
  firstRequestMedian: "首次请求 Token 中位数",
  firstRequestShare: "首次请求 Token 占比",
  firstRequestCoverage: "首次请求完整度",
  firstRequestCompositionCoverage: "首次请求 Token 构成完整度",
  coldFirstRequestRate: "首次请求未命中缓存的比例",
  identityCoverage: "任务身份可信度",
  skillInsightsTitle: "Skill 洞察",
  skillInsightsNote: "结合 Skill 使用数据与选定 SKILL.md 内容生成的模式解读；重点关注能力增量与工作流核心。",
  skillInsightLabels: {
    observation: "核心观察",
    contrast: "基准对照",
    interpretation: "为什么重要",
    consequence: "建议检查方向",
    mechanism: "机制假设",
    shiftSurface: "表面认知",
    shiftObserved: "实际数据",
    claim: "核心发现",
    action: "建议检查方向",
    evidence: "关键证据",
  },
  skillEvidence: "Skill 使用证据",
  skillState: "状态",
  availableSessions: "可用任务",
  invocationCount: "调用次数",
  skillSessions: "调用任务",
  observedFrom: "首次观察",
  observedTo: "最近观察",
  attributedTokens: "可追溯到该 Skill 的 Token",
  attributedCost: "可追溯到该 Skill 的 API 成本",
  evidenceCoverage: "有据可查比例",
  directResourceFootprint: "直接调用记录",
  observedAssociation: "时间上相关（模型调用）",
  causalImpact: "有因果证明",
  noSkillEvidence: "所选历史中没有足够证据确认 Skill 列表、调用或资源使用情况。",
  turn: "轮次",
  activeTime: "本轮耗时",
  evidenceCompleteness: "数据完整度",
  turnTrajectory: "轮次轨迹",
  keySessionAnalysis: "关键任务分析",
  taskContext: "任务背景",
  primaryFinding: "核心判断",
  evidenceChain: "证据链",
  improvementAction: "改善提议",
  verificationMethod: "如何验证",
  interpretation: "机制解释",
  proposal: "改善提议",
  analysisUnavailable: "关键任务分析不可用：",
  noStrongEvidence: "现有证据不足以支持具体机制。",
  roundCount: "轮次",
  totalDuration: "总耗时",
  roundDuration: "本轮耗时",
  processEvents: "过程事件",
  resultSize: "结果大小",
  toolCalls: "工具调用",
  sessionToken: "任务 Token",
  firstUserMessage: "第一条真实用户消息",
  chartHint: "点击或悬停数据点，查看完整真实 Prompt",
  noUserMessage: "日志未记录本轮独立的用户消息",
  allRoundDetails: "查看全部",
  detailNote: "审计附录 · 默认折叠 · 缺失值保留为 —",
  moduleDeck: "从 Token 排名进入单个任务，按轮次追踪消耗集中、过程事件与真实用户消息。",
  trajectoryIntro: "柱形表示 Token 占比，折线表示本轮耗时。深色高点可直接点按或悬停；同一个 Tooltip 先给出证据，再显示该轮第一条真实用户消息。",
  noTrajectory: "没有可用的轮次证据。",
  duration: { hour: "小时", minute: "分钟", second: "秒", separator: "" },
   header: {
     eyebrow: (dateRange) => dateRange + " 项目诊断",
     suffix: "诊断报告",
     asOf: (date) => date + " 截止",
     apiEquivalent: "API 折算",
     keyMetrics: "报告关键指标",
     overviewUnavailable: "AI 概览不可用",
     overviewEvidence: "概览证据",
   },
  checks: {
    outcome: { warning: "警告", notice: "提示", pass: "通过" },
    noFinding: "没有足够的可靠证据支持自动生成发现。",
    longSession: {
      headline: (share) => "一个任务占已观测 Token 的 " + share,
      headlinePrefix: "一个任务占已观测 Token 的 ",
      headlineSuffix: "",
      detail: (calls, tokens) => calls + " 次模型调用；" + tokens + " 个已观测 Token。",
      detailPrefix: "",
      detailBetween: " 次模型调用；",
      detailSuffix: " 个已观测 Token。",
    },
    toolAmplification: {
      headline: (estimate) => "一个工具结果可能会在后续对话中再次带入；估算暴露量为 " + estimate,
      headlinePrefix: "一个工具结果可能会在后续对话中再次带入；估算暴露量为 ",
      headlineSuffix: "",
      detail: (resultSize, characters, calls) => "工具结果大小 " + resultSize + " " + characters + "；后续有 " + calls + " 次模型调用。",
      detailPrefix: "工具结果大小 ",
      detailResultSeparator: " ",
      detailBetween: "；后续有 ",
      detailCallSuffix: " 次模型调用。",
    },
    extraCalls: {
      headline: (count) => "观察到 " + count + " 条重试、中断或子 Agent 启停记录",
      headlinePrefix: "观察到 ",
      headlineSuffix: " 条重试、中断或子 Agent 启停记录",
      detail: "这项检查只统计观测到的重试、中断和子 Agent 启停记录。",
    },
    modelConcentration: {
      headline: (model, share) => model + " 占已观测 Token 的 " + share,
      headlinePrefix: "",
      headlineBetween: " 占已观测 Token 的 ",
      headlineSuffix: "",
      detail: (calls) => calls + " 次模型调用。",
      detailPrefix: "",
      detailSuffix: " 次模型调用。",
    },
    pass: {
      headline: "历史记录未发现覆盖异常",
      detail: (records, files) => records + " 条记录来自 " + files + " 个文件；没有跳过或不完整任务。",
      detailPrefix: "",
      detailBetween: " 条记录来自 ",
      detailSuffix: " 个文件；没有跳过或不完整任务。",
    },
    coverage: {
      headline: "数据中有跳过、不完整或异常记录",
      detail: (skipped, partial, warnings) => skipped + " 条跳过记录；" + partial + " 个不完整任务；" + warnings + " 条覆盖异常·警告级。",
      detailPrefix: "",
      detailSkippedSuffix: " 条跳过记录；",
      detailPartialSuffix: " 个不完整任务；",
      detailWarningsSuffix: " 条覆盖异常·警告级。",
    },
  },
  coverageMessages: {
    alertLabel: "覆盖异常·提示级",
    clean: "历史记录解析完成，未发现覆盖异常。",
    observedCaveat: "总 Token 是已观测到、且报告能解析的记录之和；数据不完整时，实际使用量可能更高。",
    withRate: {
      text: (partial, sessions, rate) => partial + " 个任务，共 " + sessions + " 个任务（" + rate + "）不完整。",
      htmlBetween: " 个任务，共 ",
      htmlSessionPrefix: " 个任务（",
      htmlRateSuffix: "）不完整。",
    },
    withoutRate: {
      text: (partial) => partial + " 个任务数据不完整；暂时无法确认这些任务的来源交叉关系。",
      htmlSuffix: " 个任务数据不完整；暂时无法确认这些任务的来源交叉关系。",
    },
    skippedOrWarnings: "数据中有跳过记录或异常；",
    allPartialSubagents: "所有不完整任务都是已确认来源的子任务。",
    composition: {
      text: (topLevel, subagent) => " 已确认来源的不完整任务组成：顶层 " + topLevel + "，子任务 " + subagent + "。",
      htmlPrefix: " 已确认来源的不完整任务组成：顶层 ",
      htmlBetween: "，子任务 ",
      htmlSuffix: "。",
    },
    stats: (files, records, skipped, partial, warnings) => files + " 个文件，" + records + " 条记录，跳过 " + skipped + "，" + partial + " 个不完整任务，" + warnings + " 条覆盖异常·警告级。",
  },
  keySession: {
    decisionState: {
      testable: "可试",
      notRecommended: "暂不建议",
      unavailable: "不可用",
    },
    noComposition: "未生成可核对的任务解读。",
    roundLabel: (ordinal) => "第 " + ordinal + " 轮",
    concentrationUnavailable: "前 5 轮合计占比不可用",
    concentration: (count, percent) => "前 " + count + " 轮合计占 " + percent,
    factWithDuration: (concentration, round, duration) => concentration + "。" + round + "本轮耗时 " + duration + "。",
    factWithoutDuration: (concentration) => concentration + "。",
    unavailableReason: (reason) => {
      if (!reason) return "未返回合法的结构化分析。";
      if (reason === "未生成可核对的任务解读。") return reason;
      if (reason.includes("did not provide Key Session Analysis")) return "未生成可核对的任务解读。";
      if (reason.includes("duplicate Session analysis prose")) return "不同任务的解读重复，已保留确定性轨迹。";
      if (reason.includes("Codex Token accounting")) return "Codex Token 记录暂时无法核对。";
      if (reason.includes("Audit fingerprint")) return "任务解读与当前统计不匹配。";
      if (reason.includes("Turn outside")) return "任务解读引用了当前任务之外的轮次。";
      if (reason.includes("primaryFinding")) return "核心判断没有通过内容或证据校验。";
      if (reason.includes("recommendation")) return "改善提议没有通过内容或证据校验。";
      if (reason.includes("evidenceRead")) return "分析没有说明读取的轮次范围。";
      return "任务解读未通过证据核对。";
    },
    support: { strong: "强", moderate: "中", limited: "有限" },
    fallbackTaskContext: "任务解读不可用；保留确定性轮次轨迹。",
    deterministicTrajectoryAvailable: "确定性轮次轨迹仍保留。",
    evidenceStrength: (support) => "证据强度 · " + support,
    alternativeSeparator: " ",
    sessionSummaryAria: "任务摘要",
    roundUnit: "轮",
    openByDefault: "默认展开",
    collapsed: "折叠",
    rank: (index, total) => "TOKEN 排名 " + String(index).padStart(2, "0") + "，共 " + String(total).padStart(2, "0") + " 个 · 当前任务",
    moduleKicker: (harness) => "用量诊断 · " + harness,
    privacyNote: "本地完整 HTML 的 Tooltip 可包含展示轮次的完整首条用户消息；分享稿、JSON 和文本不含 Prompt。",
    listAria: "关键任务列表",
    judgmentNote: "先陈述证据支持的判断，再单独给出改善提议与验证。",
    tokenShareLabel: "前 5 轮 Token 占比",
    promptUnavailable: "首条用户消息内容不可用",
    promptAvailable: (count) => "本地 Tooltip 可查看 " + count + " 个轮次的完整首条用户消息。",
    promptMissing: "首条用户消息不可用时会保留诚实的缺失说明。",
    roundsSummary: (count) => "查看全部 " + count + " 个轮次明细",
    chartRounds: (count) => count + " 个轮次 · Token 占比和本轮耗时",
    legendAria: "图例",
    hotspots: "高用量轮次",
    otherRounds: "其他轮次",
    chartAria: (count) => count + " 个轮次的 Token 占比和本轮耗时轨迹",
    focus: "重点：",
    noScript: "图表需要 JavaScript；请展开下方完整轮次明细查看相同数据。",
  },
  charts: {
    unclassified: "未分类部分",
    cost: "按 API 单价折算的估算金额（USD）",
    summary: "每条线的纵坐标和悬停值都是该 Token 分量自身的值；各分量不堆叠。",
    localTime: "本地时间",
    hourlyDetails: "查看小时明细 ↓",
    hourlySummary: "颜色表示每个本地小时观测到的 Token；悬停查看 Token、模型调用、占审计周期比例和平均每次调用 Token。",
    hourlyDescription: "按本地日期和小时展示活动；悬停每个方块查看观测 Token、模型调用、占审计周期比例和平均每次调用 Token。下方表格提供等价数据。",
    hourlyAveragePerCall: "平均每次调用 Token（计算值）",
    hourlyShare: "占审计周期",
    hourlyNoActivity: "该小时未观察到模型调用。",
    hourlyNoTokenData: "该小时 Token 总量不可用。",
    localObservation: "本地活动",
    modelShareAria: "按模型查看 Token 占比",
    toolAria: "按工具统计工具结果被算入上下文的估算大小",
    modelAria: "按模型的 Token 分布；下方表格提供等价数据。",
    modelShareDescription: "按模型查看 Token 占比；悬停可查看精确 Token 和占比。",
    toolDescription: "按工具统计工具结果被算入上下文的估算大小；下方表格提供对应数据。",
    tokenTrendDescription: "每条线的纵坐标和悬停值都是该 Token 分量自身的值；各分量不堆叠。",
    keyShareAxis: "Token 占比",
    keyTrajectoryDescription: "每个轮次的 Token 占比和本轮耗时轨迹；Tooltip 包含完整首条用户消息。",
  },
  eventLabels: { retry: "重试", compaction: "自动压缩上下文", subagent: "子任务", interrupted: "中断" },
  skillStates: { available: "可用", invoked: "已调用", attributed: "有据可查", unavailable: "无数据" },
  warning: localizeWarningChinese,
  limitation: localizeLimitationChinese,
  method: localizeMethodChinese,
};

export const REPORT_MESSAGES = { "en-US": EN, "zh-CN": ZH } satisfies Record<string, ReportMessages>;

export type ReportLocale = keyof typeof REPORT_MESSAGES;

export function reportMessagesFor(locale: ReportLocale): ReportMessages {
  return REPORT_MESSAGES[locale];
}
