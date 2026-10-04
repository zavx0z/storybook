import WebProtocol from "@zavx0z/storybook-app-web-protocol"
import type {Zavx0zStorybookAppWebPageNavigation} from "@zavx0z/storybook-app-web-page-navigation"
type ExternalStorybookBrowserNavigationItem = ReturnType<Zavx0zStorybookAppWebPageNavigation.Output["deriveExternalStorybookNavigationTree"]>[number]
import type {Zavx0zStorybookAppWebPageShell} from "@zavx0z/storybook-app-web-page-shell"
type ExternalStorybookShell = Zavx0zStorybookAppWebPageShell.Output

import type {Zavx0zStorybookAppWebPageHome} from '../contract'

type StartExternalStorybookLandingOptions = Zavx0zStorybookAppWebPageHome.Input

import type {LandingSocket} from "../contract/types"

export function createLandingSocket(
  options: StartExternalStorybookLandingOptions,
  href: string | undefined,
): LandingSocket | null {
  if (href === undefined) return null
  const url = new URL("/api/events", href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  const token = typeof options.browserDocument?.querySelector === "function"
    ? options.browserDocument.querySelector<HTMLMetaElement>(
      'meta[name="external-storybook-browser-session"]',
    )?.content
    : typeof globalThis.document?.querySelector === "function"
      ? globalThis.document.querySelector<HTMLMetaElement>(
        'meta[name="external-storybook-browser-session"]',
      )?.content
      : undefined
  if (token !== undefined && token.length > 0) url.searchParams.set("session", token)
  if (options.createSocket !== undefined) return options.createSocket(url.href)
  return typeof WebSocket === "undefined" ? null : new WebSocket(url.href)
}

export function parseLandingEvent(value: unknown): any | null {
  if (typeof value !== "string") return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== "object" || !("type" in parsed)) return null
  const record = parsed as Record<string, unknown>
  if (record.type === "shared.updated") {
    try {
      WebProtocol.validateSharedHost(record.host)
      return record
    } catch { return null }
  }
  if (record.type === "shared.failed" && typeof record.message === "string") return record
  if (record.type === "registry.updated" && typeof record.graphDigest === "string") return record
  if (record.type === "package.updated" && typeof record.packageId === "string" && typeof record.revision === "string") return record
  if (record.type === "package.built" && typeof record.packageId === "string" && typeof record.revision === "string") return record
  if (record.type === "package.activating" && typeof record.packageId === "string" &&
    typeof record.revision === "string" && typeof record.activationId === "string") return record
  if (["package.code-updated", "package.resources-updated", "package.metadata-updated"].includes(String(record.type)) &&
    typeof record.packageId === "string") return record
  if (record.type === "package.failed" && typeof record.packageId === "string") return record
  return null
}

export function navigationItems(items: readonly ExternalStorybookBrowserNavigationItem[]) {
  return Object.freeze(items.map((item) => Object.freeze({
    id: item.id,
    label: item.label,
    route: item.route,
    title: item.title,
    searchText: item.searchText,
    ...(item.expandable === undefined ? {} : {expandable: item.expandable}),
    ...(item.parentId === undefined ? {} : {parentId: item.parentId}),
  })))
}

export function overviewDescription(kind: string): string {
  if (kind === "entry") return "У этого публичного входа нет описания с @packageDocumentation."
  if (kind === "directory") return "В index.ts этой директории нет описания модуля с @packageDocumentation."
  return "В исходнике этого пакета нет TSDoc с @packageDocumentation."
}

export async function requestRegistryChange(
  fetcher: typeof fetch,
  browserDocument: globalThis.Document,
  input: Readonly<{action: "directory" | "attach" | "detach"; body: Record<string, unknown>}>,
  readerToken?: string,
): Promise<Record<string, unknown>> {
  const session = readerToken ?? browserDocument.querySelector<HTMLMetaElement>('meta[name="external-storybook-browser-session"]')?.content
  if (!session) throw new Error("Сессия каталога недоступна. Обновите страницу.")
  const response = await fetcher(`/api/browser/${input.action}`, {
    method: "POST",
    headers: {"content-type": "application/json", "x-storybook-session": session},
    body: JSON.stringify(input.body),
  })
  const result = await response.json() as {ok?: boolean; error?: string}
  if (!response.ok || result.ok !== true) throw new Error(result.error ?? "Не удалось изменить состав Repo")
  return result
}

export function isolateLandingError(
  document: globalThis.Document,
  shell: ExternalStorybookShell,
  error: unknown,
): void {
  document.documentElement.dataset.externalStorybookLanding = "error"
  document.documentElement.dataset.externalStorybookError = errorText(error)
  shell.reportDiagnostic(errorText(error))
  shell.updateStatus("landing error")
  console.error(error)
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function assertActive(disposed: boolean): void {
  if (disposed) throw new Error("External Storybook landing is disposed")
}
