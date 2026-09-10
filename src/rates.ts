import type { ApiPricingSource, Harness, ModelCallRecord } from "./types";

export type PricingMode = "litellm";

export interface ApiRateTier {
  minInputTokens: number;
  maxInputTokens: number | null;
  /** LiteLLM `above_*` fields apply only after the threshold; ranges are inclusive. */
  minInclusive?: boolean;
  inputPerMillion?: number;
  cachedInputPerMillion?: number;
  cacheWrite5mPerMillion?: number;
  cacheWrite1hPerMillion?: number;
  outputPerMillion?: number;
}

export interface ApiRate {
  provider: string;
  model: string;
  effectiveDate: string | null;
  inputPerMillion: number | null;
  cachedInputPerMillion: number | null;
  cacheWrite5mPerMillion: number | null;
  cacheWrite1hPerMillion: number | null;
  outputPerMillion: number | null;
  tiers?: readonly ApiRateTier[];
}

export interface ApiPricingContext {
  rates: readonly ApiRate[];
  source: ApiPricingSource;
  limitations: string[];
}

export const LITELLM_MODEL_CATALOG_URL = "https://api.litellm.ai/model_catalog";

export function pricingProviderForHarness(harness: Harness): "openai" | "anthropic" {
  return harness === "codex" ? "openai" : "anthropic";
}

export const UNAVAILABLE_PRICING: ApiPricingContext = {
  rates: [],
  source: {
    kind: "litellm",
    version: "litellm-model-catalog",
    retrievedAt: null,
    effectiveDate: null,
    currency: "USD",
    unit: "USD per 1M tokens",
  },
  limitations: ["LiteLLM price lookup was not performed"],
};

interface PriceFetchInit {
  method?: string;
  signal?: AbortSignal;
}

interface PriceFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type PriceFetcher = (url: string, init?: PriceFetchInit) => Promise<PriceFetchResponse>;

interface FetchResult {
  value: unknown | null;
  status: number | null;
  failed: boolean;
}

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function pricePerMillion(value: unknown): number | null {
  const perToken = numberValue(value);
  return perToken === null ? null : perToken * 1_000_000;
}

function dateValue(...values: unknown[]): string | null {
  for (const value of values) {
    const text = stringValue(value);
    if (!text) continue;
    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  }
  return null;
}

function responseEntries(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.map(objectValue).filter((entry): entry is JsonObject => entry !== null);
  const object = objectValue(value);
  if (!object) return [];
  const data = object.data;
  if (Array.isArray(data)) return data.map(objectValue).filter((entry): entry is JsonObject => entry !== null);
  const dataObject = objectValue(data);
  if (dataObject) return [dataObject];
  return [object];
}

function exactEntry(value: unknown, provider: string, model: string): JsonObject | null {
  return responseEntries(value).find((entry) => entry.id === model && entry.provider === provider) ?? null;
}

function tierField(entry: JsonObject, field: keyof ApiRateTier): number | undefined {
  const mapping: Partial<Record<keyof ApiRateTier, string>> = {
    minInputTokens: "",
    maxInputTokens: "",
    inputPerMillion: "input_cost_per_token",
    cachedInputPerMillion: "cache_read_input_token_cost",
    cacheWrite5mPerMillion: "cache_creation_input_token_cost",
    cacheWrite1hPerMillion: "cache_creation_input_token_cost_above_1hr",
    outputPerMillion: "output_cost_per_token",
  };
  const key = mapping[field];
  if (!key) return undefined;
  const value = pricePerMillion(entry[key]);
  return value === null ? undefined : value;
}

function tierFromEntry(entry: JsonObject): ApiRateTier | null {
  const range = Array.isArray(entry.range) ? entry.range : null;
  const min = range && numberValue(range[0]);
  const max = range && numberValue(range[1]);
  if (min === null || min === undefined || max === null || max === undefined) return null;
  const tier: ApiRateTier = { minInputTokens: min, maxInputTokens: max, minInclusive: true };
  for (const field of ["inputPerMillion", "cachedInputPerMillion", "cacheWrite5mPerMillion", "cacheWrite1hPerMillion", "outputPerMillion"] as const) {
    const value = tierField(entry, field);
    if (value !== undefined) tier[field] = value;
  }
  return ["inputPerMillion", "cachedInputPerMillion", "cacheWrite5mPerMillion", "cacheWrite1hPerMillion", "outputPerMillion"]
    .some((field) => tier[field as keyof ApiRateTier] !== undefined) ? tier : null;
}

function thresholdTiers(entry: JsonObject): ApiRateTier[] {
  const tiers = new Map<number, ApiRateTier>();
  const add = (threshold: number, field: keyof ApiRateTier, value: unknown): void => {
    const price = pricePerMillion(value);
    if (price === null) return;
    const tier = tiers.get(threshold) ?? { minInputTokens: threshold, maxInputTokens: null, minInclusive: false };
    Object.assign(tier, { [field]: price });
    tiers.set(threshold, tier);
  };
  for (const [key, value] of Object.entries(entry)) {
    let match = /^input_cost_per_token_above_(\d+)k_tokens$/.exec(key);
    if (match) add(Number(match[1]) * 1_000, "inputPerMillion", value);
    match = /^cache_read_input_token_cost_above_(\d+)k_tokens$/.exec(key);
    if (match) add(Number(match[1]) * 1_000, "cachedInputPerMillion", value);
    match = /^cache_creation_input_token_cost_above_(\d+)k_tokens$/.exec(key);
    if (match) add(Number(match[1]) * 1_000, "cacheWrite5mPerMillion", value);
    match = /^cache_creation_input_token_cost_above_1hr_above_(\d+)k_tokens$/.exec(key);
    if (match) add(Number(match[1]) * 1_000, "cacheWrite1hPerMillion", value);
    match = /^output_cost_per_token_above_(\d+)k_tokens$/.exec(key);
    if (match) add(Number(match[1]) * 1_000, "outputPerMillion", value);
  }
  return [...tiers.values()];
}

function parseRate(entry: JsonObject, provider: string, model: string): ApiRate | null {
  if (entry.id !== model || entry.provider !== provider) return null;
  const inputPerMillion = pricePerMillion(entry.input_cost_per_token);
  const outputPerMillion = pricePerMillion(entry.output_cost_per_token);
  if (inputPerMillion === null || outputPerMillion === null) return null;
  const tiers = [
    ...thresholdTiers(entry),
    ...(Array.isArray(entry.tiered_pricing)
      ? entry.tiered_pricing.map(objectValue).filter((item): item is JsonObject => item !== null).map(tierFromEntry).filter((item): item is ApiRateTier => item !== null)
      : []),
  ].sort((left, right) => left.minInputTokens - right.minInputTokens);
  return {
    provider,
    model,
    effectiveDate: dateValue(entry.effective_date, entry.effectiveDate, entry.pricing_effective_date, entry.pricingEffectiveDate),
    inputPerMillion,
    cachedInputPerMillion: pricePerMillion(entry.cache_read_input_token_cost),
    cacheWrite5mPerMillion: pricePerMillion(entry.cache_creation_input_token_cost),
    cacheWrite1hPerMillion: pricePerMillion(entry.cache_creation_input_token_cost_above_1hr),
    outputPerMillion,
    ...(tiers.length > 0 ? { tiers } : {}),
  };
}

async function defaultPriceFetcher(url: string, init?: PriceFetchInit): Promise<PriceFetchResponse> {
  const response = await globalThis.fetch(url, init);
  return { ok: response.ok, status: response.status, json: () => response.json() };
}

async function fetchJson(fetcher: PriceFetcher, url: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetcher(url, { method: "GET", signal: controller.signal });
    if (!response.ok) return { value: null, status: response.status, failed: false };
    try {
      return { value: await response.json(), status: response.status, failed: false };
    } catch {
      return { value: null, status: response.status, failed: true };
    }
  } catch {
    return { value: null, status: null, failed: true };
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupLiteLlmRate(
  provider: string,
  model: string,
  fetcher: PriceFetcher,
  baseUrl: string,
): Promise<{ rate: ApiRate | null; failed: boolean }> {
  const root = baseUrl.replace(/\/+$/, "");
  const direct = await fetchJson(fetcher, root + "/" + encodeURIComponent(model));
  let entry = exactEntry(direct.value, provider, model);
  let failed = direct.failed;
  if (!entry) {
    const query = new URLSearchParams({ provider, model, page_size: "100" });
    const search = await fetchJson(fetcher, root + "?" + query.toString());
    failed = failed || search.failed;
    entry = exactEntry(search.value, provider, model);
  }
  return { rate: entry ? parseRate(entry, provider, model) : null, failed };
}

export function rateForInput(rate: ApiRate, inputTokens: number): ApiRate {
  const candidates = (rate.tiers ?? []).filter((tier) => (tier.minInclusive === false ? tier.minInputTokens < inputTokens : tier.minInputTokens <= inputTokens) && (tier.maxInputTokens === null || inputTokens < tier.maxInputTokens));
  const tier = candidates.sort((left, right) => right.minInputTokens - left.minInputTokens)[0];
  if (!tier) return rate;
  return {
    ...rate,
    inputPerMillion: tier.inputPerMillion ?? rate.inputPerMillion,
    cachedInputPerMillion: tier.cachedInputPerMillion ?? rate.cachedInputPerMillion,
    cacheWrite5mPerMillion: tier.cacheWrite5mPerMillion ?? rate.cacheWrite5mPerMillion,
    cacheWrite1hPerMillion: tier.cacheWrite1hPerMillion ?? rate.cacheWrite1hPerMillion,
    outputPerMillion: tier.outputPerMillion ?? rate.outputPerMillion,
  };
}

export async function resolveApiPricing(
  calls: ModelCallRecord[],
  harness: Harness,
  mode: PricingMode = "litellm",
  fetcher: PriceFetcher = defaultPriceFetcher,
  baseUrl = LITELLM_MODEL_CATALOG_URL,
): Promise<ApiPricingContext> {
  const pairs = [...new Map(calls
    .filter((call) => (!call.provider || call.provider === pricingProviderForHarness(harness)) && call.model)
    .map((call) => {
      const provider = pricingProviderForHarness(harness);
      return [provider + "|" + call.model, { provider, model: call.model! }] as const;
    })).values()];
  const dynamicRates: ApiRate[] = [];
  const limitations: string[] = [];
  const retrievedAt = pairs.length > 0 ? new Date().toISOString() : null;
  for (const pair of pairs) {
    const result = await lookupLiteLlmRate(pair.provider, pair.model, fetcher, baseUrl);
    if (result.rate) {
      dynamicRates.push(result.rate);
    } else {
      limitations.push(result.failed
        ? "LiteLLM price lookup failed for " + pair.provider + "/" + pair.model
        : "LiteLLM returned no exact price entry for " + pair.provider + "/" + pair.model);
    }
  }
  const effectiveDates = dynamicRates.map((rate) => rate.effectiveDate).filter((value): value is string => value !== null);
  return {
    rates: dynamicRates,
    source: {
      kind: "litellm",
      version: "litellm-model-catalog",
      retrievedAt,
      effectiveDate: effectiveDates.length > 0 && effectiveDates.every((value) => value === effectiveDates[0]) ? effectiveDates[0] : null,
      currency: "USD",
      unit: "USD per 1M tokens",
    },
    limitations: [...new Set(limitations)].sort(),
  };
}
