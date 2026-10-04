import type {Zavx0zStorybookAppWebPageNavigation} from "@zavx0z/storybook-app-web-page-navigation"
type ExternalStorybookPackageTabModel = ReturnType<Zavx0zStorybookAppWebPageNavigation.Output["deriveExternalStorybookPackageTab"]>

import type {Zavx0zStorybookAppWebPageShell} from "@zavx0z/storybook-app-web-page-shell"
type ExternalStorybookShell = Zavx0zStorybookAppWebPageShell.Output

import type {ExternalStorybookClientSnapshot, StorybookPackageRevisionGraphSnapshot, ExternalStorybookScenarioLoader, ExternalStorybookPackageEnvironment} from "./types"

/** Публичный контракт @page/package. */
export declare namespace Zavx0zStorybookAppWebPagePackage {
  type Input = Readonly<{
    packageId: string
    candidateRevision: string | null
    revisionUrl: string | null
    /** Digest of the stable platform/Storybook ESM owner set loaded by this page. */
    sharedModuleEpoch?: string
    /** Digest of the Storybook host implementation bound into the retained shell. */
    hostModuleEpoch?: string

    scenarioLoaders?: ReadonlyMap<string, ExternalStorybookScenarioLoader>
    graphSnapshot?: StorybookPackageRevisionGraphSnapshot
    environment?: ExternalStorybookPackageEnvironment
  }>

  type Output = Readonly<{
    readonly snapshot: ExternalStorybookClientSnapshot
    shell: ExternalStorybookShell
    readonly packageId: string
    readonly revision: string | null
    readonly graphDigest: string
    get currentRoute(): string
    get currentModel(): ExternalStorybookPackageTabModel
    navigate(route: string): Promise<void>
    selectScenario(value: string): void
    restoreAddress(): void
    applyRevision(revision: string): Promise<void>
    canApplyRevision(): boolean
    dispose(): Promise<void>
  }>
}
