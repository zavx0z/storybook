import type {Zavx0zStorybookAppWebProtocol} from "@zavx0z/storybook-app-web-protocol"
import type {Zavx0zStorybookAppWebPageAgentBridge} from "@zavx0z/storybook-app-web-page-agent-bridge"
import type {Zavx0zStorybookAppWebPageHome} from "@zavx0z/storybook-app-web-page-home"
type ExternalStorybookLandingController = Zavx0zStorybookAppWebPageHome.Output

import type {Zavx0zStorybookAppWebPagePackage} from "@zavx0z/storybook-app-web-page-package"
type ExternalStorybookAppliedRevision = Awaited<ReturnType<NonNullable<NonNullable<Zavx0zStorybookAppWebPagePackage.Input["environment"]>["loadAppliedRevision"]>>>
type ExternalStorybookPackageController = Zavx0zStorybookAppWebPagePackage.Output

import type {ExternalStorybookPreparedPageTarget} from "../contract/types"

export type ExternalStorybookClientSnapshot = ReturnType<Zavx0zStorybookAppWebProtocol.Output["clientSnapshot"]>

export type StorybookAgentBridge = Zavx0zStorybookAppWebPageAgentBridge.Output

export type ExternalStorybookPreparedPackageTarget = Extract<ExternalStorybookPreparedPageTarget, {kind: "revision" | "fallback"}>

export type ExternalStorybookPreparedLandingTarget = Extract<ExternalStorybookPreparedPageTarget, {kind: "landing"}>

export type ExternalStorybookPageIntent = ExternalStorybookPreparedPackageTarget["intent"]

/** Package-owned runtime, subscription и staged address без владения page shell. */
export type ActivePackagePageScope = {
  kind: "package"
  target: ExternalStorybookPreparedPackageTarget
  payload: ExternalStorybookAppliedRevision | null
  controller: ExternalStorybookPackageController
  connect(): void
  address: StorybookScopeAddress
}

/** Landing-owned registry subscription и staged address без владения page shell. */
export type ActiveLandingPageScope = {
  kind: "landing"
  target: ExternalStorybookPreparedLandingTarget
  controller: ExternalStorybookLandingController
  address: StorybookScopeAddress
}

/** Ровно один committed child scope page controller. */
export type ActivePageScope = ActivePackagePageScope | ActiveLandingPageScope

/** Минимальный public scroll transport semantic Workbench host. */
export type ScrollablePageElement = {scrollTop: number; scrollLeft: number}

/** Stable host positions и позиция заменяемого presentation root. */
export type ExternalStorybookPageScroll = Readonly<{
  stable: readonly Readonly<{top: number; left: number}>[]
  presentation: Readonly<{top: number; left: number}> | null
}>

/**
Staged URL одного ещё не committed scope.

@property location - Читает draft до commit и реальный page URL после него; reload всегда запрещён.

@property history - До commit нормализует только draft, затем передаёт операции единственному browser History.

@property address - Последний нормализованный адрес этого scope.

@property commit - Создаёт либо заменяет browser entry ровно один раз и начинает отслеживать дальнейшие route/Inspector изменения.
*/
export type StorybookScopeAddress = Readonly<{
  location: Pick<Location, "href" | "pathname" | "reload">
  history: Pick<History, "pushState" | "replaceState">
  readonly address: string
  commit(mode: "push" | "replace"): void
}>
