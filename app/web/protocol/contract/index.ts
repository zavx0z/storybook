import type {Zavx0zStorybookPackageGraphCreate} from "@zavx0z/storybook-package-graph-create"
import type {BrowserFontFaceSource} from "@zavx0z/immersive-browser/integration"
import type {StorybookSharedHost} from "./host"
import type {ClientSnapshotInput, ClientSnapshot} from "./snapshot"

export declare namespace Zavx0zStorybookAppWebProtocol {
  /** Публичные browser-safe операции одного протокола Web. */
  export type Output = Readonly<{
    clientProtocol: "external-storybook-client/1"
    resourcePrefix: "/__storybook/resources/nodes/"
    clientSnapshot(...input: ClientSnapshotInput): ClientSnapshot
    encodePackagePath(packageId: string): string
    decodePackagePath(path: string, packageIds: readonly string[]): string
    nodeResourceUrl(graph: Zavx0zStorybookPackageGraphCreate.Output, nodeId: string): string
    fontFaces: readonly BrowserFontFaceSource[]
    pageTitle(packageId: string | null, packageLabel?: string): string
    readSharedHost(fetcher: typeof fetch, readerToken: string, signal: AbortSignal,
      sharedModuleEpoch?: string, preview?: boolean): Promise<StorybookSharedHost>
    validateSharedHost(value: unknown): StorybookSharedHost
    importSharedHost<Start extends (...args: never[]) => unknown>(host: StorybookSharedHost): Promise<Start>
    synchronizeStyles(document: Document, host: StorybookSharedHost): Promise<() => void>
  }>
}
