import type {HmrConnection} from "@hmr/connection"
import type {PageShell} from "@page/shell"
import type {ExternalStorybookClientSnapshot, LandingSocket} from "./types"

type CreateExternalStorybookShellOptions = PageShell.Input
type ExternalStorybookShell = PageShell.Output

/** Публичный контракт @page/home. */
export declare namespace PageHome {
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
      reconnectSocket?(): Promise<HmrConnection.Input["socket"]>
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
