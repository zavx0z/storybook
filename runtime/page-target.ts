import type {ExternalStorybookPageIntent, ExternalStorybookPreparedPageTarget} from "./page-entry"

/**
Читает server-generated JSON target без исполнения HTML и выбора revision.

@throws При отсутствии exact script, неверном JSON или несовместимом target shape.
*/
export function readInitialPageTarget(
  document: globalThis.Document,
): ExternalStorybookPreparedPageTarget {
  const script = document.getElementById("external-storybook-page-target")
  if (script === null || script.localName.toLowerCase() !== "script" || !script.textContent) {
    throw new Error("Storybook page has no initial target")
  }
  let value: unknown
  try { value = JSON.parse(script.textContent) } catch {
    throw new Error("Storybook initial page target is invalid JSON")
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Storybook initial page target must be an object")
  }
  const record = value as Record<string, unknown>
  if (record.kind === "landing" && typeof record.pathname === "string" &&
    typeof record.readerToken === "string") {
    return Object.freeze({kind: "landing", pathname: record.pathname, readerToken: record.readerToken})
  }
  if ((record.kind === "revision" || record.kind === "fallback") &&
    typeof record.packageId === "string" &&
    (typeof record.revision === "string" || record.revision === null) &&
    (typeof record.revisionUrl === "string" || record.revisionUrl === null) &&
    typeof record.route === "string" && typeof record.urlPath === "string" &&
    ["reader", "navigation-candidate", "preview"].includes(String(record.intent)) &&
    typeof record.preview === "boolean" && typeof record.readerToken === "string") {
    return Object.freeze({
      kind: record.kind,
      packageId: record.packageId,
      revision: record.revision,
      revisionUrl: record.revisionUrl,
      payloadUrl: typeof record.payloadUrl === "string" ? record.payloadUrl : null,
      route: record.route,
      urlPath: record.urlPath,
      intent: record.intent as ExternalStorybookPageIntent,
      preview: record.preview,
      initialAppliedRevision: typeof record.initialAppliedRevision === "string" ? record.initialAppliedRevision : null,
      fallbackRevision: typeof record.fallbackRevision === "string" ? record.fallbackRevision : null,
      readerToken: record.readerToken,
    })
  }
  throw new Error("Storybook initial page target has an invalid shape")
}

