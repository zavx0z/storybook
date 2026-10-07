import type {StorybookAppWebProtocol} from "@zavx0z/storybook-app-web-protocol"
import type {StorybookAppWebPageAgentBridge} from "@zavx0z/storybook-app-web-page-agent-bridge"
import type {StorybookAppWebPageHome} from "@zavx0z/storybook-app-web-page-home"
type ExternalStorybookLandingController = StorybookAppWebPageHome.Output

import type {StorybookAppWebPagePackage} from "@zavx0z/storybook-app-web-page-package"
type ExternalStorybookAppliedRevision = Awaited<ReturnType<NonNullable<NonNullable<StorybookAppWebPagePackage.Input["environment"]>["loadAppliedRevision"]>>>
type ExternalStorybookPackageController = StorybookAppWebPagePackage.Output

import type {ExternalStorybookPreparedPageTarget} from "../contract/types"

export type ExternalStorybookClientSnapshot = ReturnType<StorybookAppWebProtocol.Output["clientSnapshot"]>

export type StorybookAgentBridge = StorybookAppWebPageAgentBridge.Output

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

/** Исполняемое представление предмета; page выбирает одно из удерживаемых представлений. */
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

@property commit - Выбирает адрес этого представления; повторный commit активного адреса ничего не меняет.
*/
export type StorybookScopeAddress = Readonly<{
  location: Pick<Location, "href" | "pathname" | "reload">
  history: Pick<History, "pushState" | "replaceState">
  readonly address: string
  commit(mode: "push" | "replace"): void
  /** Оставляет адрес фоновому представлению без права менять History страницы. */
  deactivate(): void
}>
