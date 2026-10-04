import type {Zavx0zStorybookTechHmrConnection} from "@zavx0z/storybook-tech-hmr-connection"
import type {Zavx0zStorybookAppWebPageShell} from "@zavx0z/storybook-app-web-page-shell"
import type {ExternalStorybookClientSnapshot, LandingSocket} from "./types"

type CreateExternalStorybookShellOptions = Zavx0zStorybookAppWebPageShell.Input
type ExternalStorybookShell = Zavx0zStorybookAppWebPageShell.Output

/** Публичный контракт @page/home. */
export declare namespace Zavx0zStorybookAppWebPageHome {
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
      refreshSharedHost?(): Promise<void>
      reconnectSocket?(): Promise<Zavx0zStorybookTechHmrConnection.Input["socket"]>
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
