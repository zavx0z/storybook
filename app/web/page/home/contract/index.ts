import type {StorybookTechHmrConnection} from "@zavx0z/storybook-tech-hmr-connection"
import type {StorybookAppWebPageShell} from "@zavx0z/storybook-app-web-page-shell"
import type {ExternalStorybookClientSnapshot, LandingSocket} from "./types"

type CreateExternalStorybookShellOptions = StorybookAppWebPageShell.Input
type ExternalStorybookShell = StorybookAppWebPageShell.Output

/** Публичный контракт @page/home. */
export declare namespace StorybookAppWebPageHome {
  type Input = Readonly<{
    fetcher?: typeof fetch
    browserDocument?: globalThis.Document
    pickDirectory?(): Promise<FileSystemDirectoryHandle>
    createSocket?(url: string): LandingSocket
    readerToken?: string
    navigatePackage?(input: Readonly<{packageId: string; route: string}>): Promise<void>
    location?: Pick<Location, "href" | "pathname" | "reload">
    history?: Pick<History, "pushState"> & Partial<Pick<History, "replaceState">>
    shell?: Omit<CreateExternalStorybookShellOptions, "title" | "browserDocument">
    pageScope?: Readonly<{
      shell: ExternalStorybookShell
      initialPathname: string
      isSelected?(): boolean
      catalogChanged?(snapshot: ExternalStorybookClientSnapshot): void
      refreshSharedHost?(): Promise<void>
      reconnectSocket?(): Promise<StorybookTechHmrConnection.Input["socket"]>
      navigatePackage(input: Readonly<{packageId: string; route: string}>): Promise<void>
    }>
  }>

  type Output = Readonly<{
    snapshot: ExternalStorybookClientSnapshot
    shell: ExternalStorybookShell
    select(nodeId: string): Promise<void>
    dispose(): void
  }>
}
