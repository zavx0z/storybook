import type {WebNavigation} from "@web/navigation"
type ExternalStorybookPackageTabModel = ReturnType<WebNavigation.Output["deriveExternalStorybookPackageTab"]>

import type {PageShell} from "@page/shell"
type ExternalStorybookShell = PageShell.Output

import type {ExternalStorybookClientSnapshot, StorybookPackageRevisionGraphSnapshot, ExternalStorybookScenarioLoader, ExternalStorybookPackageEnvironment} from "./types"

/** Публичный контракт @page/package. */
export declare namespace PagePackage {
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
