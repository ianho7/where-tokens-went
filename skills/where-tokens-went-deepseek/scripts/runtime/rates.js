"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.API_RATES = exports.API_RATE_SOURCE = void 0;
exports.API_RATE_SOURCE = {
    version: "2026-09-08",
    retrievedAt: "2026-09-08",
    currency: "USD",
    unit: "USD per 1M tokens",
    sources: ["https://developers.openai.com/api/docs/models/gpt-4.1"],
};
exports.API_RATES = [
    { model: "gpt-4.1", inputPerMillion: 2, cachedInputPerMillion: 0.5, outputPerMillion: 8 },
    { model: "gpt-4.1-mini", inputPerMillion: 0.4, cachedInputPerMillion: 0.1, outputPerMillion: 1.6 },
    { model: "gpt-4.1-nano", inputPerMillion: 0.1, cachedInputPerMillion: 0.025, outputPerMillion: 0.4 },
];
