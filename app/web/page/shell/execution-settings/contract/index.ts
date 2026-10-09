/** Окно настроек среды использует штатную browser-сессию текущей страницы. */
export declare namespace StorybookAppWebPageShellExecutionSettings {
  /** Транспорт подставляется в проверках; открытие выбора модели читает настройки и возможности без prompt. */
  type Input = Readonly<{
    /** Каталоги среды: транспорт передаётся приложением, UI не выполняет файловые операции. */
    directories?: Readonly<{
      read(signal: AbortSignal): Promise<Directories>
      save(draft: DirectoryDraft, signal: AbortSignal): Promise<Directories>
    }> | undefined
    fetcher?: typeof fetch
    initialState?: Partial<WindowState> | undefined
    onStateChange?: ((state: WindowState) => void) | undefined
  }>

}

/** Геометрию и видимость сохраняет приложение; черновик настроек сюда не входит. */
type WindowState = Readonly<{
  open: boolean
  geometry: Readonly<{x: number, y: number, width: number, height: number}>
  tab: Readonly<{edge: "left" | "right" | "top" | "bottom", offset: number}>
}>

type Directories = Readonly<{
  repositoriesDirectory: string | null
  projectsDirectory: string | null
}>

type DirectoryDraft = Readonly<{
  repositoriesDirectory: string
  projectsDirectory: string
}>
