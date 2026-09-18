type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function textValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map(textValue).filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  const object = objectValue(value);
  if (!object) return null;
  const type = typeof object.type === "string" ? object.type.toLowerCase() : "";
  if (type.includes("tool_result") || type.includes("tool-result")) return null;
  if (typeof object.text === "string") return object.text;
  if (object.content !== undefined) return textValue(object.content);
  return null;
}

/** Preserve message text without truncation while removing credential values. */
export function firstUserMessageText(value: unknown): string | null {
  const text = textValue(value);
  if (text === null) return null;
  return text
    .replace(/((?:api[_-]?key|access[_-]?token|password|secret|credential)\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <redacted>");
}
