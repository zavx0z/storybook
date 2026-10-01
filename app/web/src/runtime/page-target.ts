import type {ExternalStorybookPageIntent, ExternalStorybookPagePrepareInput, ExternalStorybookPreparedPageTarget} from "./page-entry"

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


/**
Вызывает единственный server-owned resolver package target без выбора revision в runtime.

Для landing получает отдельный registry reader. Для package отправляет только
packageId, route и optional preview revision; built/active/last-working policy
остаётся на сервере.

@param fetcher - Same-origin transport текущего Storybook server.

@param input - Typed navigation intent из {@link ExternalStorybookPagePrepareInput}.

@param signal - Отменяет HTTP и запрещает использовать поздний target.

@returns Exact target с reader token и server-resolved URL.

@throws При ошибке transport, protocol или shape ответа.

@example
```ts
const target = await prepareExternalStorybookPageTarget(
  fetch,
  {packageId: "@immersive/markdown", route: "", intent: "navigation"},
  signal,
)
```
*/
export async function prepareExternalStorybookPageTarget(
  fetcher: typeof fetch,
  input: ExternalStorybookPagePrepareInput,
  signal: AbortSignal,
): Promise<ExternalStorybookPreparedPageTarget> {
  if (input.packageId === null) {
    const response = await fetcher("/api/browser/registry-session", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({}),
      signal,
    })
    if (!response.ok) throw new Error("Storybook registry reader prepare failed")
    const value = await response.json() as Record<string, unknown>
    if (value.protocol !== "storybook-registry-reader/1" || typeof value.readerToken !== "string") {
      throw new Error("Storybook registry reader response is invalid")
    }
    return Object.freeze({kind: "landing", pathname: input.route || "/", readerToken: value.readerToken})
  }
  const response = await fetcher("/api/browser/prepare", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({
      packageId: input.packageId,
      route: input.route,
      previewRevision: input.intent === "preview" ? input.requestedRevision ?? null : null,
    }),
    signal,
  })
  if (!response.ok) throw new Error(`Storybook package prepare failed: ${input.packageId}`)
  const value = await response.json() as Record<string, unknown>
  const fallback = value.revision === null && value.revisionUrl === null
  if (value.protocol !== "storybook-package-prepare/1" || value.packageId !== input.packageId ||
    (!fallback && (typeof value.revision !== "string" || typeof value.revisionUrl !== "string")) ||
    (fallback && (value.preview !== false || value.intent !== "reader" || value.payloadUrl != null)) ||
    typeof value.route !== "string" || typeof value.urlPath !== "string" ||
    !["reader", "navigation-candidate", "preview"].includes(String(value.intent)) ||
    typeof value.preview !== "boolean" || typeof value.readerToken !== "string") {
    throw new Error(`Storybook package prepare response is invalid: ${input.packageId}`)
  }
  return Object.freeze({
    kind: fallback ? "fallback" : "revision",
    packageId: value.packageId,
    revision: fallback ? null : value.revision as string,
    revisionUrl: fallback ? null : value.revisionUrl as string,
    payloadUrl: typeof value.payloadUrl === "string" ? value.payloadUrl : null,
    route: value.route,
    urlPath: value.urlPath,
    intent: value.intent as ExternalStorybookPageIntent,
    preview: value.preview,
    initialAppliedRevision: typeof value.initialAppliedRevision === "string" ? value.initialAppliedRevision : null,
    fallbackRevision: typeof value.fallbackRevision === "string" ? value.fallbackRevision : null,
    readerToken: value.readerToken,
  })
}

