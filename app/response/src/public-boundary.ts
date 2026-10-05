const FORBIDDEN_KEYS = new Set([
  "artifactRoot",
  "controlToken",
  "dependencyRealpaths",
  "entryRelativePath",
  "manifestPath",
  "outputPath",
  "packageJsonPath",
  "packageRoot",
  "pid",
  "port",
  "processId",
  "projectRoot",
  "readmePath",
  "revisions",
  "sourcePath",
  "stagingDirectory",
  "tabIndex",
  "targetId",
  "toolRoot",
  "url",
  "windowId",
])

export function sanitizePublicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePublicValue)
  if (typeof value === "string") return sanitizePublicString(value)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !FORBIDDEN_KEYS.has(key))
    .map(([key, entry]) => [key, sanitizePublicValue(entry)]))
}

export function sanitizePublicString(value: string): string {
  return value
    .replace(/https?:\/\/(?:127\.0\.0\.1|localhost):[0-9]+/giu, "[storybook-origin]")
    .replace(/((?:target(?:Id)?|windowId|tabIndex)\s*(?:[:=]|is)\s*)[A-Za-z0-9_-]+/giu, "$1[opaque]")
    .replace(/(target\s+with\s+id\s+)[A-Za-z0-9_-]+/giu, "$1[opaque]")
    .replace(/((?:master\s+token|control\s+token|capability\s+token)\s*(?:[:=]|is)?\s*)[^\s,;]+/giu,
      "$1[redacted]")
    .replace(/(?:file:\/\/)?\/(?:Users|private\/var|var\/folders|tmp)\/(?:[^/\\\s:]+\/)*[^/\\\s:),;\]}]*/gu,
      "[owner-path]")
}

export function sanitizePublicText(value: string, mimeType: string): string {
  if (mimeType === "application/json") {
    try {
      return JSON.stringify(sanitizePublicValue(JSON.parse(value)))
    } catch {
      // Invalid JSON remains bounded text and is still path/capability scrubbed.
    }
  }
  return sanitizePublicString(value)
}
