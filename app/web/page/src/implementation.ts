import type {HmrConnection} from "@hmr/connection"

import createStorybookAgentBridge from "@web/agent-bridge"

import type {PageShell} from "@page/shell"
type ExternalStorybookShell = PageShell.Output

import type {ExternalStorybookPreparedPageTarget} from "../contract/types"

import type {ActivePackagePageScope, ActivePageScope, ScrollablePageElement, ExternalStorybookPageScroll, StorybookScopeAddress} from "./types"

export const STORYBOOK_AGENT_BRIDGE_GLOBAL = createStorybookAgentBridge.global

/** Возвращает текущий package scope для bridge callback после live owner check. */
export function requirePackageScope(scope: ActivePageScope | null): ActivePackagePageScope {
  if (scope?.kind !== "package") throw new Error("External Storybook page has no active package scope")
  return scope
}

/** Снимает scroll до scoped teardown без клонирования semantic nodes. */
export function readPageScroll(shell: ExternalStorybookShell): ExternalStorybookPageScroll {
  const values: unknown[] = [
    shell.workbench.elements.catalogItems,
    shell.workbench.elements.tabItems,
    shell.workbench.elements.inspectorHost,
    shell.workbench.elements.previewHost,
    shell.hud.querySelector('[data-storybook-part="catalog-items"] [role="tree"]'),
  ]
  const stable = Object.freeze(values.filter(isScrollablePageElement)
    .map(element => Object.freeze({top: element.scrollTop, left: element.scrollLeft})))
  const presentation = shell.workbench.controller.read("presentation").node
  return Object.freeze({
    stable,
    presentation: isScrollablePageElement(presentation)
      ? Object.freeze({top: presentation.scrollTop, left: presentation.scrollLeft})
      : null,
  })
}

/** Возвращает stable host scroll и переносит presentation position на новый root. */
export function restorePageScroll(shell: ExternalStorybookShell, scroll: ExternalStorybookPageScroll): void {
  const candidates: unknown[] = [shell.workbench.elements.catalogItems, shell.workbench.elements.tabItems,
    shell.workbench.elements.inspectorHost, shell.workbench.elements.previewHost,
    shell.hud.querySelector('[data-storybook-part="catalog-items"] [role="tree"]')]
  const elements = candidates.filter(isScrollablePageElement)
  scroll.stable.forEach((value, index) => {
    const element = elements[index]
    if (element === undefined) return
    element.scrollTop = value.top
    element.scrollLeft = value.left
  })
  const presentation = shell.workbench.controller.read("presentation").node
  if (scroll.presentation !== null && isScrollablePageElement(presentation)) {
    presentation.scrollTop = scroll.presentation.top
    presentation.scrollLeft = scroll.presentation.left
  }
}

/** Проверяет только нужную page controller часть scroll contract. */
export function isScrollablePageElement(value: unknown): value is ScrollablePageElement {
  return value !== null && typeof value === "object" &&
    typeof (value as {scrollTop?: unknown}).scrollTop === "number" &&
    typeof (value as {scrollLeft?: unknown}).scrollLeft === "number"
}

/**
Создаёт staged URL, чтобы initial `replaceState` нового scope не изменил history прежнего.

@param target - Server-resolved package URL либо landing pathname.

@param pageLocation - Реальный URL, который до commit остаётся нетронутым.

@param pageHistory - Единственный browser History owner.

@param onCommittedAddress - Обновляет rollback address после route и Inspector операций active scope.

@returns Draft adapter, передаваемый только создаваемому package или landing scope.
*/
export function createStorybookScopeAddress(
  target: ExternalStorybookPreparedPageTarget,
  pageLocation: Pick<Location, "href" | "pathname">,
  pageHistory: Pick<History, "pushState" | "replaceState">,
  onCommittedAddress: (address: string) => void,
): StorybookScopeAddress {
  let committed = false
  let draft = new URL(pageLocation.href)
  const destination = new URL(target.kind === "landing" ? target.pathname : target.urlPath, draft)
  draft.pathname = destination.pathname
  draft.searchParams.delete("view")
  const view = destination.searchParams.get("view")
  if (view !== null) draft.searchParams.set("view", view)
  draft.searchParams.delete("preview")
  if (target.kind !== "landing" && target.intent === "preview" && target.revision !== null) {
    draft.searchParams.set("preview", target.revision)
  }
  const updateDraft = (value: string | URL | null): void => {
    if (value !== null) draft = new URL(String(value), draft.href)
  }
  const location = {
    get href() {
      return committed ? pageLocation.href : draft.href
    },
    set href(value: string) {
      if (committed) throw new Error("Storybook scope cannot assign browser location")
      draft = new URL(value, draft.href)
    },
    get pathname() {
      return committed ? pageLocation.pathname : draft.pathname
    },
    reload() {
      throw new Error("Storybook scope cannot reload its page")
    },
  }
  const history = {
    pushState(data: unknown, unused: string, url?: string | URL | null) {
      if (!committed) {
        updateDraft(url ?? null)
        return
      }
      pageHistory.pushState(data, unused, url)
      onCommittedAddress(currentPageAddress(pageLocation))
    },
    replaceState(data: unknown, unused: string, url?: string | URL | null) {
      if (!committed) {
        updateDraft(url ?? null)
        return
      }
      pageHistory.replaceState(data, unused, url)
      onCommittedAddress(currentPageAddress(pageLocation))
    },
  }
  const value: StorybookScopeAddress = Object.freeze({
    location,
    history,
    get address() {
      const current = committed ? new URL(pageLocation.href) : draft
      return `${current.pathname}${current.search}${current.hash}`
    },
    commit(mode) {
      if (committed) return
      const address = `${draft.pathname}${draft.search}${draft.hash}`
      if (mode === "push") pageHistory.pushState(null, "", address)
      else pageHistory.replaceState(null, "", address)
      committed = true
      onCommittedAddress(address)
    },
  })
  return value
}

/** Возвращает pathname, query и hash без origin для bounded rollback history. */
export function currentPageAddress(location: Pick<Location, "href" | "pathname">): string {
  const url = new URL(location.href)
  return `${url.pathname}${url.search}${url.hash}`
}

/**
Откладывает создание final package socket до committed markers, bridge и кадра.

Listeners регистрируются сразу, поэтому scope не знает о задержке. `close()` до
`connect()` отменяет владение без открытия transport; после `connect()` adapter
прозрачно передаёт события exact socket.

@param create - Factory с уже выданным exact reader token.

@returns Socket-compatible adapter с однократным `connect()`.
*/
export function createDeferredStorybookSocket(
  create: () => HmrConnection.Input["socket"],
): HmrConnection.Input["socket"] & Readonly<{connect(): void}> {
  const listeners = new Map<string, Set<(event: any) => void>>()
  let socket: HmrConnection.Input["socket"] | null = null
  let closed = false
  const deferred = {
    addEventListener(type: string, listener: (event: any) => void) {
      const values = listeners.get(type) ?? new Set()
      values.add(listener)
      listeners.set(type, values)
      socket?.addEventListener(type, listener)
    },
    removeEventListener(type: string, listener: (event: any) => void) {
      listeners.get(type)?.delete(listener)
      socket?.removeEventListener(type, listener)
    },
    send(data: string) {
      if (socket === null) throw new Error("Storybook package socket is not connected")
      socket.send(data)
    },
    close() {
      closed = true
      socket?.close()
      socket = null
    },
    connect() {
      if (closed || socket !== null) return
      socket = create()
      for (const [type, values] of listeners) {
        for (const listener of values) socket.addEventListener(type, listener)
      }
    },
  }
  return Object.freeze(deferred)
}
