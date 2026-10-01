import {
  STORYBOOK_PAGE_REALM_PROTOCOL,
  type ExternalStorybookAppliedRevision,
} from "./package-entry.ts"

const REVISION_PAYLOAD_FILE = "revision-payload.js"

/** Один literal revision URL загружается только после проверки package identity и revision. */
export type StorybookAppliedRevisionImporter = (url: string) => Promise<unknown>

/**
Создаёт browser loader applied revision из того же package route.

Importer не получает пути source tree и не может загрузить произвольный module URL:
package identity фиксируется при создании, а revision допускает только bounded
opaque token. Проверка AbortSignal выполняется до и после dynamic import.
*/
export function createStorybookAppliedRevisionLoader(
  packageId: string,
  importer: StorybookAppliedRevisionImporter = url => import(url),
): (revision: string, signal: AbortSignal) => Promise<ExternalStorybookAppliedRevision> {
  const owner = exactPackageId(packageId)
  return (revision, signal) => loadStorybookAppliedRevision(owner, revision, signal, importer)
}

/** Загружает immutable payload exact пакета без привязки page controller к прежнему owner. */
export async function loadStorybookAppliedRevision(
  packageId: string,
  revision: string,
  signal: AbortSignal,
  importer: StorybookAppliedRevisionImporter = url => import(url),
): Promise<ExternalStorybookAppliedRevision> {
  const owner = exactPackageId(packageId)
  const candidate = exactRevision(revision)
  signal.throwIfAborted()
  const value = await importer(`/__storybook/revisions/${encodeURIComponent(owner)}/${candidate}/${REVISION_PAYLOAD_FILE}`)
  signal.throwIfAborted()
  if (value === null || typeof value !== "object" ||
    !Object.hasOwn(value, "STORYBOOK_APPLIED_REVISION")) {
    throw new Error("Storybook applied revision payload is unavailable")
  }
  const payload = (value as Record<string, unknown>).STORYBOOK_APPLIED_REVISION
  if (payload === null || typeof payload !== "object" ||
    (payload as Record<string, unknown>).protocol !== STORYBOOK_PAGE_REALM_PROTOCOL) {
    throw new Error("Storybook applied revision payload has an invalid protocol")
  }
  return payload as ExternalStorybookAppliedRevision
}

function exactPackageId(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 ||
    !/^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) {
    throw new Error("Storybook applied revision package identity is invalid")
  }
  return value
}

function exactRevision(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 ||
    /[^A-Za-z0-9_-]/u.test(value)) {
    throw new Error("Storybook applied revision is invalid")
  }
  return value
}
