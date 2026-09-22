export {validStorybookViewQuery} from "./view-query.ts"

/**
Семантическая цель действия внутри представления Storybook.

@property [nodeId] - Идентификатор узла, полученный при инспекции.

@property [role] - Роль элемента при выборе по роли и имени.

@property [name] - Точное имя элемента при выборе вместе с ролью.
*/
export type StorybookBrowserInteractionTarget = Readonly<{
  nodeId?: string | undefined
  role?: string | undefined
  name?: string | undefined
}>

/**
Значение действия браузерного протокола.

Строка задаёт клавишу, текст либо значение действия `scenario`; число — вертикальное
смещение прокрутки. Объекты задают клавишу с модификаторами, текст, смещения
прокрутки `deltaX`, `deltaY`, `deltaZ` либо относительное перетаскивание `dx`, `dy`.
Допустимая форма определяется действием, а не выбирается по произвольному приведению типа.
*/
export type StorybookBrowserInteractionValue =
  | string
  | number
  | Readonly<{key: string; modifiers?: readonly ("alt" | "ctrl" | "meta" | "shift")[] | undefined}>
  | Readonly<{text: string}>
  | Readonly<{deltaY: number; deltaX?: number | undefined; deltaZ?: number | undefined}>
  | Readonly<{dx: number; dy: number}>

/**
Запрос одного действия в выбранном браузерном представлении.

@property viewId - Непрозрачный идентификатор представления Storybook, не идентификатор CDP.

@property [target] - Цель {@link StorybookBrowserInteractionTarget} для действия с узлом.

@property action - Действие ввода либо действие `scenario`.

@property [value] - Значение {@link StorybookBrowserInteractionValue}, соответствующее действию.

@property [destination] - Идентификатор конечного узла при перетаскивании к другому элементу.

@property [timeoutMs] - Лимит выполнения действия в миллисекундах.
*/
export type StorybookBrowserInteractInput = Readonly<{
  viewId: string
  target?: StorybookBrowserInteractionTarget | undefined
  action: "hover" | "focus" | "click" | "pointerDown" | "pointerUp" | "drag" | "key" | "type" | "wheel" | "scenario"
  value?: StorybookBrowserInteractionValue | undefined
  destination?: Readonly<{nodeId: string}> | undefined
  timeoutMs?: number | undefined
}>

/**
Запрос захвата области браузерного представления.

@property [viewId] - Непрозрачный идентификатор представления, выбранного для захвата.

@property area - Область: страница, рабочая область, предварительный просмотр, холст или узел.

@property [nodeId] - Идентификатор захватываемого узла для области `node`.

@property [failOnConsoleError] - Признак неуспеха захвата при обнаружении ошибок консоли.

@property [timeoutMs] - Лимит ожидания захвата в миллисекундах.
*/
export type StorybookBrowserCaptureInput = Readonly<{
  viewId?: string | undefined
  area: "page" | "workbench" | "preview" | "canvas" | "node"
  nodeId?: string | undefined
  failOnConsoleError?: boolean | undefined
  timeoutMs?: number | undefined
}>

/**
Краткие сведения о цели подключения Chrome.

@property targetId - Идентификатор цели CDP, используемый только браузерным клиентом.

@property type - Вид цели Chrome, например `page`.

@property title - Заголовок цели.

@property url - Адрес, открытый в цели.
*/
export type ChromeTargetSummary = Readonly<{
  targetId: string
  type: string
  title: string
  url: string
}>

/**
Идентичность и состояние моста управления одной загруженной страницей.

@property protocol - Маркер версии протокола моста.

@property packageId - Идентификатор пакета страницы.

@property route - Текущий маршрут внутри пакета.

@property revision - Ревизия страницы либо `null`, если она недоступна.

@property graphDigest - Контрольный отпечаток графа либо `null`, если он недоступен.

@property ready - Признак готовности страницы.

@property presented - Признак опубликованного представления.

@property timeOrigin - Начало временной шкалы текущего документа, используемое для различения загрузок.

@property [frameSequence] - Номер кадра, если мост предоставляет сведения о кадрах.
*/
export type StorybookBridgeIdentity = Readonly<{
  protocol: "external-storybook-agent-bridge/1"
  packageId: string
  route: string
  revision: string | null
  graphDigest: string | null
  ready: boolean
  presented: boolean
  timeOrigin: number
  frameSequence?: number
}>

/**
Прямоугольная область захвата, передаваемая клиенту Chrome.

Клиент отклоняет нечисловые, бесконечные и выходящие за указанные границы значения.

@property x - Горизонтальная координата области; модуль значения не более 1000000.

@property y - Вертикальная координата области; модуль значения не более 1000000.

@property width - Ширина области: больше 0 и не больше 16384.

@property height - Высота области: больше 0 и не больше 16384.

@property [scale=1] - Масштаб захвата: больше 0 и не больше 4.
*/
export type StorybookBridgeClip = Readonly<{
  x: number
  y: number
  width: number
  height: number
  scale?: number
}>

/**
Методы моста страницы: чтение идентичности, инспекция, взаимодействие,
подготовка захвата и применение ревизии. Произвольные имена методов не принимаются.
*/
export type StorybookBridgeMethod = "identity" | "inspect" | "interact" | "capture" | "applyRevision"

/**
Внутренняя привязка представления Storybook к конкретной цели Chrome.

@property viewId - Непрозрачный идентификатор представления Storybook.

@property targetId - Внутренний идентификатор цели CDP.

@property origin - Источник адреса сервера, которому принадлежит представление.

@property packageId - Идентификатор открытого пакета.

@property route - Маршрут внутри пакета.

@property url - Полный адрес представления.

@property title - Заголовок представления.
*/
export type StorybookInternalView = Readonly<{
  viewId: string
  targetId: string
  origin: string
  packageId: string
  route: string
  url: string
  title: string
}>

/**
Публичные сведения о представлении без служебных адресов и идентификаторов CDP.

@property viewId - Непрозрачный идентификатор для последующих операций Storybook.

@property packageId - Идентификатор открытого пакета.

@property route - Маршрут внутри пакета.

@property title - Заголовок представления.
*/
export type StorybookPublicView = Readonly<{
  viewId: string
  packageId: string
  route: string
  title: string
}>

/**
Запись консоли или журнала Chrome в период наблюдения.

@property [type] - Тип вызова консоли либо источник записи журнала.

@property [level] - Уровень сообщения.

@property [text] - Текст сообщения, ограниченный браузерным клиентом.

@property [url] - Адрес источника сообщения.

@property [line] - Номер строки из записи Chrome без пересчёта.

@property [timestamp] - Временная отметка Chrome без преобразования.
*/
export type StorybookChromeConsoleEntry = Readonly<{
  type?: string
  level?: string
  text?: string
  url?: string
  line?: number
  timestamp?: number
}>

/**
Внутренний клиент Chrome для жизненного цикла представлений Storybook.

Идентификаторы целей и адрес подключения остаются внутри браузерного слоя.
Методы принимают необязательный сигнал отмены; работа страницы вызывается
через ограниченный набор методов {@link StorybookBridgeMethod}.
*/
export interface StorybookChromeClient {
  /**
  Проверяет доступность браузерного подключения; его получение может запустить
  принадлежащий Storybook браузер согласно настройкам клиента.
  */
  health(signal?: AbortSignal): Promise<void>
  /**
  Возвращает локальный адрес подключения к Chrome DevTools Protocol.
  */
  cdpOrigin(signal?: AbortSignal): Promise<string>
  /**
  Возвращает идентификатор экземпляра браузера, связанный с адресом его отладочного соединения.
  */
  browserIdentity(signal?: AbortSignal): Promise<string>
  /**
  Читает список доступных целей Chrome без передачи адресов отладочных соединений.
  */
  targets(signal?: AbortSignal): Promise<readonly ChromeTargetSummary[]>
  /**
  Создаёт фоновую вкладку по абсолютному HTTP- или HTTPS-адресу.
  */
  createTarget(url: string, signal?: AbortSignal): Promise<ChromeTargetSummary>
  /**
  Создаёт фоновую вкладку с уведомлением непосредственно перед отправкой команды.

  `beforeSend` вызывается синхронно; до него команда создания цели не отправляется.

  @param url - Абсолютный HTTP- или HTTPS-адрес новой вкладки.

  @param beforeSend - Обработчик границы отправки команды создания.

  @param signal - Необязательная отмена запроса.
  */
  createTargetWithDispatch?(url: string, beforeSend: () => void, signal?: AbortSignal): Promise<ChromeTargetSummary>
  /**
  Закрывает только цель с указанным идентификатором.
  */
  closeTarget(targetId: string, signal?: AbortSignal): Promise<void>
  /**
  Открывает HTTP- или HTTPS-адрес в указанной цели и ожидает готовности после перехода.
  */
  navigate(targetId: string, url: string, signal?: AbortSignal): Promise<void>
  /**
  Ожидает готовности цели после загрузки или смены контекста.

  @param targetId - Идентификатор цели Chrome.

  @param timeoutMs - Лимит в миллисекундах: целое число от 100 до 120000.

  @param signal - Необязательная отмена ожидания.

  @throws Ошибка диапазона при недопустимом лимите; ошибка ожидания при истечении времени.
  */
  waitReady(targetId: string, timeoutMs: number, signal?: AbortSignal): Promise<void>
  /**
  Собирает сообщения консоли и журнала выбранной цели.

  @param targetId - Идентификатор цели Chrome.

  @param durationMs - Период наблюдения в миллисекундах: целое число от 0 до 30000.

  @param signal - Необязательная отмена наблюдения.

  @returns Сообщения в порядке получения.

  @throws Ошибка диапазона при недопустимой длительности.
  */
  consoleEntries(targetId: string, durationMs: number, signal?: AbortSignal): Promise<readonly StorybookChromeConsoleEntry[]>
  /**
  Читает диагностические сведения о загрузке и наличии моста страницы.
  */
  bridgeDiagnostics(targetId: string, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>>
  /**
  Вызывает один из разрешённых методов моста страницы.

  @param targetId - Идентификатор цели Chrome.

  @param method - Метод из {@link StorybookBridgeMethod}.

  @param params - Параметры метода, представимые в JSON.

  @param signal - Необязательная отмена запроса.

  @returns Значение, возвращённое мостом страницы.
  */
  callBridge(targetId: string, method: StorybookBridgeMethod, params: unknown, signal?: AbortSignal): Promise<unknown>
  /**
  Захватывает поверхность страницы и возвращает байты PNG.

  @param targetId - Идентификатор цели Chrome.

  @param options - Подпись снимка, необязательная область {@link StorybookBridgeClip}
  и лимит ожидания в миллисекундах. Подпись содержит от 1 до 512 символов без
  управляющих символов; заданный лимит — целое число от 100 до 120000.

  @param signal - Необязательная отмена захвата.

  @returns Двоичные данные PNG, декодированные из ответа Chrome.
  */
  screenshot(
    targetId: string,
    options: Readonly<{caption: string; clip?: StorybookBridgeClip; timeoutMs?: number}>,
    signal?: AbortSignal,
  ): Promise<Uint8Array>
}

/**
Читает признак времени запуска процесса по его PID.

@returns Значение для различения запусков с одинаковым PID либо `null`,
если сведения о запуске недоступны.
*/
export type StorybookProcessStart = (pid: number) => string | null

/**
Именованные области захвата: вся страница, рабочая область, предварительный
просмотр, холст и отдельный семантический узел.
*/
export type StorybookCaptureArea = "page" | "workbench" | "preview" | "canvas" | "node"

/**
Связь снимка с пакетом, маршрутом и ревизией показанного содержимого.

@property packageId - Идентификатор пакета снимка.

@property route - Маршрут показанного содержимого.

@property graphDigest - Контрольный отпечаток графа, к которому относится снимок.

@property revision - Ревизия показанного содержимого.

@property area - Захваченная область {@link StorybookCaptureArea}.

@property [nodeId] - Идентификатор узла при захвате отдельного элемента.

@property consoleErrors - Ошибки консоли, обнаруженные при захвате.
*/
export type StorybookCaptureMetadata = Readonly<{
  packageId: string
  route: string
  graphDigest: string
  revision: string
  area: StorybookCaptureArea
  nodeId?: string
  consoleErrors: readonly unknown[]
}>

/**
Сохранённый снимок с метаданными {@link StorybookCaptureMetadata}.

@property captureId - Идентификатор сохранённого снимка.

@property resourceUri - URI ресурса для чтения снимка.

@property mimeType - Тип изображения `image/png`.

@property width - Ширина сохранённого изображения в пикселях.

@property height - Высота сохранённого изображения в пикселях.

@property bytes - Размер сохранённых двоичных данных в байтах.

@property sha256 - Контрольная сумма SHA-256 данных снимка.

@property capturedAt - Время создания снимка в строковом представлении.
*/
export type StoredStorybookCapture = StorybookCaptureMetadata & Readonly<{
  captureId: string
  resourceUri: string
  mimeType: "image/png"
  width: number
  height: number
  bytes: number
  sha256: string
  capturedAt: string
}>

/**
Строит публичный сегмент URL без изменения идентификатора самого пакета.

@param packageId - Имя пакета, при наличии области имён — в форме `@scope/name`.
Допускаются строчные латинские буквы, цифры и предусмотренные проверкой разделители.

@returns Имя без начального `@`, с заменой `/` между областью и именем на `-`.

@throws Ошибка при недопустимом идентификаторе пакета.
*/
export function storybookPackagePathSegment(packageId: string): string {
  if (typeof packageId !== "string" || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(packageId)) {
    throw new Error(`Invalid Storybook package identity: ${packageId}`)
  }
  return packageId.replace(/^@/u, "").replace("/", "-")
}

/**
Сопоставляет сегмент URL с известным пакетом, принимая читаемую форму
и ранее опубликованную форму с кодированием идентификатора.
*/
export function storybookPackagePathMatches(segment: string, packageId: string): boolean {
  return segment === storybookPackagePathSegment(packageId) || segment === encodeURIComponent(packageId)
}

/**
Строит публичный путь страницы отдельно от внутреннего ключа навигации.

@param packageId - Точный идентификатор пакета.

@param route - Маршрут внутри пакета; пустая строка обозначает его начало.
Структурные сегменты `dir-` сохраняются, остальные сегменты кодируются для URL.

@throws Ошибка при недопустимом имени пакета или структурном маршруте.
*/
export function storybookPackageUrlPath(packageId: string, route = ""): string {
  const base = `/pkg-${storybookPackagePathSegment(packageId)}/`
  if (route.startsWith("dir-")) {
    const parts = route.split("/")
    const directories = ["dependencies", "contract", "scenarios"].includes(parts.at(-1) ?? "") ? parts.slice(0, -1) : parts
    if (directories.some(part => !part.startsWith("dir-") || part.length === 4)) throw new Error("Invalid structural directory route")
    return `${base}${route}`
  }
  return `${base}${route.split("/").map(encodeURIComponent).join("/")}`
}

/**
Извлекает маршрут известного пакета из пути страницы, включая прежние адреса.

@param pathname - Путь URL без строки запроса.

@param packageId - Идентификатор пакета, которому должен принадлежать адрес.

@returns Маршрут внутри пакета либо `null` при несовпадении адреса
или недопустимых сегментах.
*/
export function storybookPackageRouteFromPathname(pathname: string, packageId: string): string | null {
  const segments = pathname.split("/")
  const legacy = segments[1] === "packages"
  const offset = legacy ? 2 : 1
  const segment = segments[offset]
  if (segments[0] !== "" || segment === undefined ||
    !(legacy ? storybookPackagePathMatches(segment, packageId) : segment === `pkg-${storybookPackagePathSegment(packageId)}`)) return null
  const parts = segments.slice(offset + 1)
  const trailingSlash = parts.at(-1) === ""
  if (trailingSlash) parts.pop()
  if (parts.some(part => part.length === 0)) return null
  try {
    const decoded = parts.map(part => {
      const value = decodeURIComponent(part)
      if (encodeURIComponent(value) !== part || value === "." || value === ".." || value.includes("/") || value.includes("\\")) throw new Error("Invalid route segment")
      return value
    })
    if (!legacy && parts[0]?.startsWith("dir-")) {
      const directories = ["dependencies", "contract", "scenarios"].includes(parts.at(-1) ?? "") ? parts.slice(0, -1) : parts
      if (directories.some(part => !part.startsWith("dir-") || part.length === 4)) return null
      return parts.join("/")
    }
    return decoded.join("/")
  } catch {
    return null
  }
}

/**
Преобразует ранее опубликованный ключ директории на границе адаптера.
Префикс `~directories/` заменяется структурными сегментами `dir-`;
остальные маршруты сохраняются без изменения.
*/
export function storybookCurrentRouteKey(route: string): string {
  return route.startsWith("~directories/")
    ? route.slice("~directories/".length).split("/").map(segment => `dir-${segment}`).join("/")
    : route
}
