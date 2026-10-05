/** Окно настроек среды использует штатную browser-сессию текущей страницы. */
export declare namespace StorybookAppWebPageShellExecutionSettings {
  /** Транспорт подставляется в проверках; открытие выбора модели читает настройки и возможности без prompt. */
  type Input = Readonly<{
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
