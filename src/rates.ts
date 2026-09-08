/**
 * Versioned public API rates used only for exact model identifiers. The report
 * never substitutes a family or provider alias when this table has no match.
 */
export interface ApiRate {
  model: string;
  inputPerMillion: number;
  cachedInputPerMillion: number | null;
  outputPerMillion: number;
}

export const API_RATE_SOURCE = {
  version: "2026-09-08",
  retrievedAt: "2026-09-08",
  currency: "USD" as const,
  unit: "USD per 1M tokens" as const,
  sources: ["https://developers.openai.com/api/docs/models/gpt-4.1"],
};

export const API_RATES: readonly ApiRate[] = [
  { model: "gpt-4.1", inputPerMillion: 2, cachedInputPerMillion: 0.5, outputPerMillion: 8 },
  { model: "gpt-4.1-mini", inputPerMillion: 0.4, cachedInputPerMillion: 0.1, outputPerMillion: 1.6 },
  { model: "gpt-4.1-nano", inputPerMillion: 0.1, cachedInputPerMillion: 0.025, outputPerMillion: 0.4 },
];