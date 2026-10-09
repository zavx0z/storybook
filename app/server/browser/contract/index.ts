import type {
  StorybookBrowserOpenInput,
  StorybookBrowserCaptureResult,
  StorybookBrowserCaptureInput,
  StorybookBrowserInteractInput,
  StorybookChromeClient,
  StorybookBrowserPackage,
  StorybookProcessStart,
  StorybookPublicView,
  StorybookBridgeIdentity,
  StoredStorybookCapture,
} from "./types"

/** Контракт единого пространства внешнего Storybook. */
export declare namespace StorybookAppServerBrowser {
  /**
  Приватные директории состояния и снимков, а также необязательный клиент Chrome.

  @property stateRoot - Корень записей browser views и lock.

  @property captureRoot - Корень сохранённых PNG.

  @property [chrome] - Подставленный клиент для проверки или особой среды;
  при отсутствии создаётся штатный CDP client.

  @property [processStart] - Проверяет начало процесса по PID для защиты от reuse.
  */
  type Input = Readonly<{
    stateRoot: string
    captureRoot: string
    chrome?: StorybookChromeClient
    processStart?: StorybookProcessStart
  }>

  /**
  Один владелец открытия, инвентаря, взаимодействия и снимков пространства.

  @property openPackage - Выбирает пакет или корень Project в общем пространстве.
  Первое открытие создаёт одну страницу; переход сохраняет её realm.

  @property listViews - Читает только принадлежащие указанному origin views.

  @property getView - Возвращает публичные сведения точного view ID.

  @property [applyRevision] - Применяет ревизию в уже открытой странице и
  проверяет сохранение browser realm, когда клиент предоставляет метод.

  @property inspect - Читает ограниченную диагностику bridge указанной страницы.

  @property interact - Выполняет одно ограниченное действие по семантической цели.

  @property capture - Сохраняет PNG с identity показанной ревизии.

  @property close - Закрывает только выбранную вкладку.

  @property readCapture - Читает ранее сохранённый PNG по capture ID.
  */
  type Output = Readonly<{
    openPackage(input: StorybookBrowserOpenInput, signal?: AbortSignal): Promise<Readonly<{
      view: StorybookPublicView
      identity: StorybookBridgeIdentity
      reused: boolean
    }>>
    /** Читает единственное выбранное пространство, не открывая браузер. */
    currentWorkspace(origin: string, signal?: AbortSignal, packages?: readonly StorybookBrowserPackage[]): Promise<Readonly<{
      view: StorybookPublicView
      identity: StorybookBridgeIdentity
    }> | null>
    /** Возвращает выбранный адрес; иной packageId даёт пустой список. */
    listViews(origin: string, signal?: AbortSignal, packages?: readonly StorybookBrowserPackage[], packageId?: string): Promise<readonly StorybookPublicView[]>
    getView(viewId: string): StorybookPublicView
    applyRevision?(viewId: string, revision: string, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>>
    /** При запросе diagnostics и недоступном JS-мосте возвращает короткий native CPU-профиль той же вкладки. */
    inspect(viewId: string, input: Readonly<{include?: readonly string[]; maxDepth?: number; limit?: number; cursor?: string}>, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>>
    interact(input: StorybookBrowserInteractInput, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>>
    capture(input: StorybookBrowserCaptureInput, signal?: AbortSignal): Promise<StorybookBrowserCaptureResult>
    close(viewId: string, signal?: AbortSignal): Promise<Readonly<{closed: boolean; viewId: string; preserved?: boolean}>>
    readCapture(captureId: string): Readonly<{metadata: StoredStorybookCapture; png: Uint8Array}>
  }>
}
