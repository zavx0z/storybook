/**
Версия схемы запросов к управляющему контроллеру Storybook.
*/
export const STORYBOOK_MCP_SCHEMA_VERSION = 1 as const

/**
Итог управляющей операции: `success` — выполнена, `failed` — ошибка,
`timeout` — истекло время ожидания, `unavailable` — выполнение недоступно.
Это статус контроллера, а не интерпретация произвольного HTTP-ответа прокси.
*/
export type StorybookOperationStatus = "success" | "failed" | "timeout" | "unavailable"

/**
Общая оболочка результата управляющей операции.

Дополнительные поля зависят от вызванного метода контроллера.

@property status - Итог операции {@link StorybookOperationStatus}.
*/
export type StorybookControllerResult = Readonly<{
  status: StorybookOperationStatus
  [key: string]: unknown
}>

/**
Запуск или повторное использование единственного сервера Storybook.

@property schemaVersion - Версия запроса, равная {@link STORYBOOK_MCP_SCHEMA_VERSION}.

@property [roots] - Корни, подключаемые вместе с обеспечением работы сервера.
На границе MCP — не более 32 уникальных непустых путей.
*/
export type StorybookEnsureInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  roots?: readonly string[] | undefined
}>

/**
Чтение состояния сервера и выбранной области без его запуска.

@property schemaVersion - Версия запроса, равная {@link STORYBOOK_MCP_SCHEMA_VERSION}.

@property [scope] - Идентификатор области, состояние которой запрашивается.

@property [includeViews] - Включение сведений об открытых представлениях.
*/
export type StorybookStatusInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  scope?: string | undefined
  includeViews?: boolean | undefined
}>

/**
Подключение физического пакета и его workspaces к каталогу.

@property schemaVersion - Версия запроса, равная {@link STORYBOOK_MCP_SCHEMA_VERSION}.

@property root - Путь к подключаемому пакету с package.json.
*/
export type StorybookAttachInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  root: string
}>

/**
Удаление одной подключённой области из каталога без удаления файлов репозитория.

@property schemaVersion - Версия запроса, равная {@link STORYBOOK_MCP_SCHEMA_VERSION}.

@property scopeId - Идентификатор ранее подключённой области каталога.
*/
export type StorybookDetachInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  scopeId: string
}>

/**
Поиск узлов канонического графа с постраничным получением результатов.

@property schemaVersion - Версия запроса, равная {@link STORYBOOK_MCP_SCHEMA_VERSION}.

@property query - Непустой поисковый текст; на границе MCP — не более 512 символов.

@property [packageId] - Точный идентификатор выбранного пакета, без восстановления
имени по отображаемому адресу.

@property [kinds] - Уникальные виды узлов, которыми ограничен поиск.

@property [limit] - Максимальное число результатов на странице. На границе MCP —
целое число от 1 до 200 включительно; остальные значения отклоняются.

@property [cursor] - Указатель продолжения предыдущей страницы результатов.
*/
export type StorybookSearchInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  query: string
  packageId?: string | undefined
  kinds?: readonly ("workspace" | "project" | "package" | "directory" | "category" | "subject" | "variant" | "unavailable")[] | undefined
  limit?: number | undefined
  cursor?: string | undefined
}>

/**
Открытие представления кандидата выбранного пакета.

@property schemaVersion - Версия запроса, равная {@link STORYBOOK_MCP_SCHEMA_VERSION}.

@property packageId - Точный идентификатор пакета.

@property [route] - Нормализованный маршрут внутри пакета. На границе MCP допускается
пустая строка, но не ведущий или конечный `/`, пустые сегменты, `.` и `..`,
обратная косая черта, строка запроса или фрагмент URL.

@property [recover] - Явное восстановление зависшей попытки открытия, если вкладки пакета отсутствуют.
*/
export type StorybookOpenInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  packageId: string
  route?: string | undefined
  recover?: boolean | undefined
}>

/**
Ожидание заданного состояния пакета или представления.

На границе MCP требуется `packageId` либо `viewId`. Для условий `built`,
`active` и `failed` допускается только выбор пакета, без `viewId`.

@property schemaVersion - Версия запроса, равная {@link STORYBOOK_MCP_SCHEMA_VERSION}.

@property [packageId] - Точный идентификатор выбранного пакета, без восстановления
имени по отображаемому адресу.

@property [viewId] - Непрозрачный идентификатор представления, полученный от Storybook.

@property [afterRevision] - Ревизия, относительно которой ожидается изменение.

@property condition - Ожидаемый признак: сборка, применение, готовность, показ либо ошибка.

@property [timeoutMs] - Лимит ожидания в миллисекундах. На границе MCP принимается
целое число от 100 до 120000 включительно; остальные значения отклоняются.
*/
export type StorybookWaitInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  packageId?: string | undefined
  viewId?: string | undefined
  afterRevision?: string | undefined
  condition: "built" | "active" | "ready" | "presented" | "failed"
  timeoutMs?: number | undefined
}>

/**
Чтение состояния и диагностических проекций одного представления.

@property schemaVersion - Версия запроса, равная {@link STORYBOOK_MCP_SCHEMA_VERSION}.

@property viewId - Непрозрачный идентификатор открытого представления.

@property [include] - Разделы ответа: состояние, диагностика, консоль, семантические узлы,
раскладка, поверхность отображения и холст.

@property [maxDepth] - Предельная глубина обхода. На границе MCP — целое число
от 0 до 12 включительно; остальные значения отклоняются.

@property [limit] - Максимальное число элементов на странице. На границе MCP —
целое число от 1 до 200 включительно; остальные значения отклоняются.

@property [cursor] - Указатель продолжения ранее полученной страницы.
*/
export type StorybookInspectInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  viewId: string
  include?: readonly ("state" | "diagnostics" | "console" | "semantic" | "layout" | "display" | "canvas")[] | undefined
  maxDepth?: number | undefined
  limit?: number | undefined
  cursor?: string | undefined
}>

/**
Семантический выбор цели без экранных координат.

На границе MCP требуется `nodeId` либо точная пара `role` и `name`.

@property [nodeId] - Идентификатор семантического узла.

@property [role] - Роль искомого элемента.

@property [name] - Точное доступное имя элемента для поиска вместе с ролью.
*/
export type StorybookInteractionTarget = Readonly<{
  nodeId?: string | undefined
  role?: string | undefined
  name?: string | undefined
}>

/**
Данные выбранного действия с представлением.

`key` принимает строку клавиши либо объект с `key` и модификаторами.
`type` принимает строку либо объект с `text`; `wheel` — число либо объект
с `deltaY` и необязательными `deltaX` и `deltaZ`. Для относительного перетаскивания
передаются `dx` и `dy`; действие `scenario` принимает строку.

На границе MCP числовые смещения конечны и лежат от -10000 до 10000 включительно,
строка текста ограничена 4096 символами, имя клавиши — от 1 до 64 символов.
Недопустимые значения отклоняются. Единицы смещений определяет действие.
*/
export type StorybookInteractionValue =
  | string
  | number
  | Readonly<{key: string; modifiers?: readonly ("alt" | "ctrl" | "meta" | "shift")[] | undefined}>
  | Readonly<{text: string}>
  | Readonly<{deltaY: number; deltaX?: number | undefined; deltaZ?: number | undefined}>
  | Readonly<{dx: number; dy: number}>

/**
Одно семантическое действие в выбранном представлении.

@property schemaVersion - Версия запроса, равная {@link STORYBOOK_MCP_SCHEMA_VERSION}.

@property viewId - Непрозрачный идентификатор открытого представления.

@property [target] - Цель {@link StorybookInteractionTarget}; обязательна на границе MCP
для всех перечисленных действий с узлом, кроме `scenario`.

@property action - Выбранное действие ввода либо действие `scenario`.

@property [value] - Данные {@link StorybookInteractionValue}. Для `hover`, `focus`,
`click`, `pointerDown` и `pointerUp` значение не передаётся.

@property [destination] - Узел назначения перетаскивания. Допускается только для `drag`
вместо относительного смещения `dx` и `dy`, а не одновременно с ним.

@property [timeoutMs] - Лимит действия в миллисекундах. На границе MCP — целое число
от 100 до 30000 включительно; остальные значения отклоняются.
*/
export type StorybookInteractInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  viewId: string
  target?: StorybookInteractionTarget | undefined
  action: "hover" | "focus" | "click" | "pointerDown" | "pointerUp" | "drag" | "key" | "type" | "wheel" | "scenario"
  value?: StorybookInteractionValue | undefined
  destination?: Readonly<{nodeId: string}> | undefined
  timeoutMs?: number | undefined
}>

/**
Захват выбранной области представления в PNG.

На границе MCP требуется `viewId` либо `packageId`.

@property schemaVersion - Версия запроса, равная {@link STORYBOOK_MCP_SCHEMA_VERSION}.

@property [viewId] - Непрозрачный идентификатор представления, полученный от Storybook.

@property [packageId] - Точный идентификатор выбранного пакета, без восстановления
имени по отображаемому адресу.

@property [route] - Маршрут внутри выбранного пакета.

@property area - Область снимка: страница, рабочая область, предварительный просмотр,
холст либо один семантический узел.

@property [nodeId] - Идентификатор узла. На границе MCP обязателен только для `area: "node"`
и запрещён для остальных областей.

@property [failOnConsoleError] - Считать обнаруженные ошибки консоли причиной неуспеха захвата.

@property [timeoutMs] - Лимит ожидания в миллисекундах. На границе MCP принимается
целое число от 100 до 120000 включительно; остальные значения отклоняются.
*/
export type StorybookCaptureInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  viewId?: string | undefined
  packageId?: string | undefined
  route?: string | undefined
  area: "page" | "workbench" | "preview" | "canvas" | "node"
  nodeId?: string | undefined
  failOnConsoleError?: boolean | undefined
  timeoutMs?: number | undefined
}>

/**
Подготовка кандидата пакета с необязательной проверкой и применением в браузере.

@property schemaVersion - Версия запроса, равная {@link STORYBOOK_MCP_SCHEMA_VERSION}.

@property scope - Выбранная область проверки Storybook.

@property [live] - При `true` кандидат проверяется в браузере и применяется ко всем
вкладкам этого пакета после успеха. Ошибка сохраняет ранее применённую ревизию.

@property [timeoutMs] - Лимит ожидания в миллисекундах. На границе MCP принимается
целое число от 100 до 120000 включительно; остальные значения отклоняются.
*/
export type StorybookCheckInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  scope: string
  live?: boolean | undefined
  timeoutMs?: number | undefined
}>

/**
Закрытие одного представления без выбора посторонних вкладок.

@property schemaVersion - Версия запроса, равная {@link STORYBOOK_MCP_SCHEMA_VERSION}.

@property viewId - Непрозрачный идентификатор закрываемого представления.
*/
export type StorybookCloseInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  viewId: string
}>

/**
Явная остановка принадлежащего Storybook сервера.

@property schemaVersion - Версия запроса, равная {@link STORYBOOK_MCP_SCHEMA_VERSION}.

@property confirm - Обязательное подтверждение остановки; принимается только `true`.
*/
export type StorybookStopInput = Readonly<{
  schemaVersion: typeof STORYBOOK_MCP_SCHEMA_VERSION
  confirm: true
}>

/**
Изображение для передачи в содержимом ответа MCP.

@property data - Данные изображения в кодировке Base64.

@property mimeType - Тип содержимого `image/png`.
*/
export type StorybookCaptureImage = Readonly<{
  data: string
  mimeType: "image/png"
}>

/**
Результат управляющего захвата с изображением при его наличии.

Общие поля результата принадлежат {@link StorybookControllerResult}.

@property [image] - Изображение {@link StorybookCaptureImage}; может отсутствовать при неуспехе захвата.
*/
export type StorybookCaptureResult = StorybookControllerResult & Readonly<{
  image?: StorybookCaptureImage
}>

/**
Результат чтения ресурса Storybook для передачи через MCP.

@property status - Итог чтения {@link StorybookOperationStatus}.

@property uri - Адрес запрошенного ресурса.

@property mimeType - Тип содержимого ресурса.

@property [text] - Текстовое содержимое при его наличии.

@property [blob] - Двоичное содержимое в кодировке Base64 при его наличии.

@property [error] - Код `code` и пояснение `message` ошибки чтения.
*/
export type StorybookResourceResult = Readonly<{
  status: StorybookOperationStatus
  uri: string
  mimeType: string
  text?: string
  blob?: string
  error?: Readonly<{code: string; message: string}>
}>

/**
Контекст отмены одной управляющей операции.

@property signal - Сигнал отмены, передаваемый из вызывающего транспорта.
*/
export type StorybookControllerContext = Readonly<{
  signal: AbortSignal
}>

/**
Общий управляющий контракт, реализуемый ядром внешнего Storybook.

Контроллер связывает сервер, каталог, сессии пакетов и представления браузера.
Каждый вызов получает контекст отмены {@link StorybookControllerContext}.
Предметный HTTP-прокси не интерпретирует результаты этого контракта.
*/
export interface ExternalStorybookController {
  /**
  Запускает или повторно использует сервер и подключает переданные корни.
  */
  ensure(input: StorybookEnsureInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  /**
  Читает состояние сервера, каталога, сессий и запрошенных представлений без запуска сервера.
  */
  status(input: StorybookStatusInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  /**
  Подключает область к сохранённому каталогу, повторно используя существующие записи.
  */
  attach(input: StorybookAttachInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  /**
  Удаляет область из каталога и закрывает её представления, сохраняя файлы репозитория.
  */
  detach(input: StorybookDetachInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  /**
  Возвращает страницу результатов поиска по каноническому графу.
  */
  search(input: StorybookSearchInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  /**
  Открывает кандидата в подходящей вкладке пакета либо новой фоновой вкладке,
  не перенаправляя представления других пакетов.
  */
  open(input: StorybookOpenInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  /**
  Ожидает состояние выбранного пакета или представления до отмены либо истечения лимита.
  */
  wait(input: StorybookWaitInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  /**
  Возвращает выбранные разделы состояния и диагностики представления.
  */
  inspect(input: StorybookInspectInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  /**
  Выполняет семантическое действие без передачи произвольного JavaScript или идентификатора CDP.
  */
  interact(input: StorybookInteractInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  /**
  Захватывает указанную область и возвращает изображение и сведения о результате.
  */
  capture(input: StorybookCaptureInput, context: StorybookControllerContext): Promise<StorybookCaptureResult>
  /**
  Собирает кандидата; при `live: true` проверяет и применяет его после успеха.
  */
  check(input: StorybookCheckInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  /**
  Закрывает только представление с переданным идентификатором.
  */
  close(input: StorybookCloseInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  /**
  Останавливает принадлежащий Storybook сервер при явном подтверждении.
  */
  stop(input: StorybookStopInput, context: StorybookControllerContext): Promise<StorybookControllerResult>
  /**
  Читает текстовый или двоичный ресурс по его URI.
  */
  readResource(uri: string, context: StorybookControllerContext): Promise<StorybookResourceResult>
}
