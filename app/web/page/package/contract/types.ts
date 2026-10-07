import type {StorybookAppWebProtocol} from "@zavx0z/storybook-app-web-protocol"
import type {StorybookTechHmrConnection} from "@zavx0z/storybook-tech-hmr-connection"
import type {StorybookAppWebPagePackageScenarioModel} from "@zavx0z/storybook-app-web-page-package-scenario-model"

import type {StorybookPackageRevision} from "@zavx0z/storybook-package-revision"
import type {StorybookAppWebPageShell} from "@zavx0z/storybook-app-web-page-shell"
type CreateExternalStorybookShellOptions = StorybookAppWebPageShell.Input
type ExternalStorybookShell = StorybookAppWebPageShell.Output

import type {STORYBOOK_PAGE_REALM_PROTOCOL} from "../src/implementation"

export type ExternalStorybookClientSnapshot = ReturnType<StorybookAppWebProtocol.Output["clientSnapshot"]>

/** Форма исходного публичного владельца. */
export type ScenarioAppInput = StorybookAppWebPagePackageScenarioModel.Input

export type StorybookPackageRevisionGraphSnapshot = ReturnType<StorybookPackageRevision.Output["create"]>

export type ExternalStorybookScenarioLoader = () => Promise<ScenarioAppInput>

/** Данные и сценарии ревизии пакета; контроллерами страницы владеет текущая оболочка. */
export interface ExternalStorybookAppliedRevision {
  readonly protocol: typeof STORYBOOK_PAGE_REALM_PROTOCOL
  readonly packageId: string
  readonly candidateRevision: string
  readonly revisionUrl: string
  readonly sharedModuleEpoch: string
  readonly hostModuleEpoch?: string
  readonly graphSnapshot: StorybookPackageRevisionGraphSnapshot

  readonly scenarioLoaders?: ReadonlyMap<string, ExternalStorybookScenarioLoader>
}

export type ExternalStorybookPackageEnvironment = Readonly<{
  fetcher?: typeof fetch
  browserDocument?: globalThis.Document
  location?: Pick<Location, "pathname" | "href" | "reload">
  history?: Pick<History, "pushState" | "replaceState">
  createSocket?(url: string): StorybookTechHmrConnection.Input["socket"]
  navigatePackage?(input: Readonly<{packageId: string; route: string}>): Promise<void>
  navigateLanding?(pathname: string): Promise<void>
  /** Already authenticated pending socket transferred by the page controller at commit. */
  socket?: StorybookTechHmrConnection.Input["socket"]
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
    /** Фоновое представление не публикует identity в общий native Document. */
    isSelected?(): boolean
    catalogChanged?(snapshot: ExternalStorybookClientSnapshot): void
    navigatePackage(input: Readonly<{packageId: string; route: string}>): Promise<void>
    navigateLanding(pathname: string): Promise<void>
    applyRevision?(revision: string): Promise<void>
    refreshSharedHost?(): Promise<void>
    readerRenewed?(readerToken: string): void
    revisionApplied(payload: ExternalStorybookAppliedRevision): void
    revisionConfirmed(revision: string): void
  }>
}>
