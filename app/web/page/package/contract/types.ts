import type {AppWebProtocol} from "@app-web/protocol"
import type {HmrConnection} from "@hmr/connection"
import type startExternalStorybookPage from "@web/page"
import type {ScenarioModel} from "@scenario/model"

import type {PackageRevision} from "@package/revision"
import type {PageShell} from "@page/shell"
type CreateExternalStorybookShellOptions = PageShell.Input
type ExternalStorybookShell = PageShell.Output

import type {STORYBOOK_PAGE_REALM_PROTOCOL} from "../src/implementation"
import type {PagePackage} from "./index"

export type ExternalStorybookClientSnapshot = ReturnType<AppWebProtocol.Output["clientSnapshot"]>

/** Форма исходного публичного владельца. */
export type ScenarioAppInput = ScenarioModel.Input

export type StorybookPackageRevisionGraphSnapshot = ReturnType<PackageRevision.Output["create"]>

export type ExternalStorybookScenarioLoader = () => Promise<ScenarioAppInput>

/**
Immutable executable payload для динамической замены ревизии внутри страницы.

@property [startPage] - При смене платформы принимает Canvas и монтирует согласованную среду.
@property [startPackage] - Обновляет контекст пакета при сохранении текущей платформы.
*/
export interface ExternalStorybookAppliedRevision {
  readonly protocol: typeof STORYBOOK_PAGE_REALM_PROTOCOL
  readonly packageId: string
  readonly candidateRevision: string
  readonly revisionUrl: string
  readonly sharedModuleEpoch: string
  readonly hostModuleEpoch?: string
  readonly startPackage?: (input: PagePackage.Input) => Promise<PagePackage.Output>
  readonly startPage?: typeof startExternalStorybookPage
  readonly graphSnapshot: StorybookPackageRevisionGraphSnapshot

  readonly scenarioLoaders?: ReadonlyMap<string, ExternalStorybookScenarioLoader>
}

export type ExternalStorybookPackageEnvironment = Readonly<{
  fetcher?: typeof fetch
  browserDocument?: globalThis.Document
  location?: Pick<Location, "pathname" | "href" | "reload">
  history?: Pick<History, "pushState" | "replaceState">
  createSocket?(url: string): HmrConnection.Input["socket"]
  navigatePackage?(input: Readonly<{packageId: string; route: string}>): Promise<void>
  navigateLanding?(pathname: string): Promise<void>
  /** Already authenticated pending socket transferred by the page controller at commit. */
  socket?: HmrConnection.Input["socket"]
  bootstrapIntent?: "reader" | "navigation-candidate" | "preview"
  initialAppliedRevision?: string | null
  fallbackRevision?: string | null
  shell?: Omit<
    CreateExternalStorybookShellOptions,
    "title" | "browserDocument" | "authorStyleSheetSources"
  >
  /** Focused lifecycle cancellation seam; browser production also uses pagehide. */
  lifecycleSignal?: AbortSignal
  /** Focused cleanup seam; production bounds uncooperative owner cleanup. */
  cleanupTimeoutMs?: number
  /** Loads a payload whose executable imports share this page's exact platform module identities. */
  loadAppliedRevision?(
    revision: string,
    signal: AbortSignal,
  ): Promise<ExternalStorybookAppliedRevision>
  /** Page-owned shell and cross-package transition used by one replaceable package scope. */
  pageScope?: Readonly<{
    shell: ExternalStorybookShell
    initialRoute: string
    navigatePackage(input: Readonly<{packageId: string; route: string}>): Promise<void>
    navigateLanding(pathname: string): Promise<void>
    applyRevision?(revision: string): Promise<void>
    refreshSharedHost?(): Promise<void>
    readerRenewed?(readerToken: string): void
    revisionApplied(payload: ExternalStorybookAppliedRevision): void
    revisionConfirmed(revision: string): void
  }>
}>
