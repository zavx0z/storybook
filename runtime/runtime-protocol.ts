import type {
  Document as SemanticDocument,
  Node as SemanticNode,
} from "@zavx0z/dom"
import type {SpaceElement} from "@zavx0z/dom/space"
import type {StorybookRuntimeStyleSheetRoot} from "./source-projection.ts"

/**
Точный маркер структурного протокола, реализуемого исполняемыми адаптерами пакетов.
*/
export const STORYBOOK_RUNTIME_PROTOCOL = "storybook-runtime/4" as const
/**
Маркер протокола публикации одного представления истории.
*/
export const STORYBOOK_PRESENTATION_PROTOCOL = "story-presentation/1" as const

/**
Одна операция над загруженной историей в контексте вкладки конкретного пакета.

@property route - Маршрут загруженной истории внутри пакета.

@property story - Значение, полученное загрузчиком истории.

@property signal - Сигнал отмены текущей операции.
*/
export type StorybookRuntimeStoryInput = Readonly<{
  route: string
  story: unknown
  signal: AbortSignal
}>

/**
Исходные представления истории для просмотра в редакторе.

@property html - Представление разметки в HTML.

@property typescript - Исходный пример на TypeScript.
*/
export type StorybookRuntimeSourceInput = Readonly<{
  html: string
  typescript: string
}>

/**
Единое представление владельца, публикуемое для текущего монтажа или обновления.

@property protocol - Маркер {@link STORYBOOK_PRESENTATION_PROTOCOL}.

@property node - Семантический узел показываемого содержимого.

@property componentRoot - Корень компонента, предоставляющий связанные таблицы стилей.

@property source - Исходники {@link StorybookRuntimeSourceInput} для редактора.

@property [values] - Дополнительные значения для секций инспектора.
*/
export type StorybookRuntimePresentationInput = Readonly<{
  protocol: typeof STORYBOOK_PRESENTATION_PROTOCOL
  node: SemanticNode
  componentRoot: StorybookRuntimeStyleSheetRoot
  source: StorybookRuntimeSourceInput
  values?: Readonly<Record<string, unknown>>
}>

/**
Положение обзора в единственном пространстве страницы.

Используется правая система координат с осью Z вверх; расстояния заданы в миллиметрах.

@property position - Положение точки обзора по координатам `x`, `y`, `z`.

@property target - Точка, на которую направлен обзор, в той же системе координат.

@property [fov] - Передаваемый угол поля зрения.

@property [near] - Расстояние до ближней плоскости отсечения.

@property [far] - Расстояние до дальней плоскости отсечения.
*/
export type StorybookSpacePreviewCamera = Readonly<{
  position: Readonly<{x: number; y: number; z: number}>
  target: Readonly<{x: number; y: number; z: number}>
  fov?: number
  near?: number
  far?: number
}>

/**
Границы одного пространственного просмотра в логических координатах и буфере кадра.

@property x - Горизонтальное положение логической области.

@property y - Вертикальное положение логической области.

@property width - Логическая ширина области.

@property height - Логическая высота области.

@property backingX - Горизонтальное положение в буфере кадра, в пикселях.

@property backingY - Вертикальное положение в буфере кадра, в пикселях.

@property backingWidth - Ширина в буфере кадра, в пикселях.

@property backingHeight - Высота в буфере кадра, в пикселях.

@property pixelRatio - Отношение размера буфера кадра к логическому размеру.
*/
export type StorybookSpacePreviewViewport = Readonly<{
  x: number
  y: number
  width: number
  height: number
  backingX: number
  backingY: number
  backingWidth: number
  backingHeight: number
  pixelRatio: number
}>

/**
Согласованная регистрация семантического узла и его показа в общем пространстве.

@property node - Семантический узел пространственного содержимого.

@property camera - Исходное положение обзора {@link StorybookSpacePreviewCamera}.

@property [cameraGestures] - Управление обзором жестами при его включении.
*/
export type StorybookSpacePreviewRegistration = Readonly<{
  node: SemanticNode
  camera: StorybookSpacePreviewCamera
  cameraGestures?: boolean
  /**
  Получает новые логические границы и размеры буфера кадра при изменении области просмотра.
  */
  resize?(viewport: StorybookSpacePreviewViewport): void
  /**
  Обрабатывает двойной щелчок в пространственном просмотре, если обработчик задан.
  */
  onDoubleClick?(): void
}>

/**
Ограниченное управление обзором и кадрами без доступа к внутреннему Renderer.

@property frames - Счётчик кадров пространственного просмотра.

@property disposed - Признак завершённого жизненного цикла просмотра.
*/
export type StorybookSpacePreview = Readonly<{
  readonly frames: number
  readonly disposed: boolean
  /**
  Запрашивает следующий кадр пространственного просмотра.
  */
  requestRender(): void
  /**
  Возвращает точку обзора к исходному положению.
  */
  resetViewPoint(): void
  /**
  Освобождает регистрацию пространственного просмотра.
  */
  dispose(): void
}>

/**
Возможности, общие для всех контекстов представления, заданных декларацией владельца.

@property document - Семантический документ страницы.

@property signal - Сигнал отмены работы контекста.
*/
export type StorybookRuntimeContextBase = Readonly<{
  document: SemanticDocument
  signal: AbortSignal
  /**
  Публикует единое представление текущей операции {@link StorybookRuntimePresentationInput}.
  */
  present(value: StorybookRuntimePresentationInput): void
  /**
  Передаёт диагностическое значение принимающей стороне.
  */
  reportDiagnostic(value: unknown): void
  /**
  Запрашивает перерисовку представления.
  */
  requestRender(): void
}>

/**
Контекст поверхности отображения или экранного слоя без владения пространством.

@property projection - Проекция `display` либо `hud`, выбранная декларацией.
*/
export type StorybookComponentRuntimeContext = StorybookRuntimeContextBase & Readonly<{
  projection: "display" | "hud"
}>

/**
Объявленная пространственная проекция в единственном пространстве и точке обзора страницы.

@property projection - Пространственная проекция `space`.

@property space - Общий семантический элемент пространства {@link SpaceElement}.
*/
export type StorybookSpaceRuntimeContext = StorybookRuntimeContextBase & Readonly<{
  projection: "space"
  space: SpaceElement
  /**
  Регистрирует пространственный просмотр в существующем пространстве.

  @param registration - Узел, исходный обзор и обработчики его жизненного цикла.

  @returns Управление просмотром {@link StorybookSpacePreview}.
  */
  mountSpacePreview(registration: StorybookSpacePreviewRegistration): StorybookSpacePreview
}>

/**
Контекст исполнения, выбранный по проекции в декларации предмета: компонентный или пространственный.
*/
export type StorybookRuntimeContext =
  | StorybookComponentRuntimeContext
  | StorybookSpaceRuntimeContext

/**
Границы области просмотра и размеры содержащего её видимого пространства.

@property x - Горизонтальное положение области.

@property y - Вертикальное положение области.

@property width - Ширина области.

@property height - Высота области.

@property viewportWidth - Ширина видимого пространства.

@property viewportHeight - Высота видимого пространства.
*/
export type StorybookPreviewBounds = Readonly<{
  x: number
  y: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
}>

/**
Сессия исполнения, принадлежащая пакету.

Состояние навигации и реестра остаётся у внешнего Storybook.
Монтаж и обновление публикуют представление через переданный контекст.
*/
export type StorybookRuntimeSession = Readonly<{
  /**
  Монтирует загруженную историю и публикует её представление.
  */
  mount(input: StorybookRuntimeStoryInput): void | Promise<void>
  /**
  Обновляет уже смонтированную историю, если сессия поддерживает обновление.
  */
  update?(input: StorybookRuntimeStoryInput): void | Promise<void>
  /**
  Демонтирует текущую историю перед заменой или завершением сессии.
  */
  unmount(): void | Promise<void>
  /**
  Освобождает ресурсы сессии пакета.
  */
  dispose(): void | Promise<void>
}>

/**
Структурный адаптер, экспортируемый исполняемым пакетом.

@property protocol - Поддерживаемый маркер {@link STORYBOOK_RUNTIME_PROTOCOL}.
*/
export type StorybookRuntimeAdapter = Readonly<{
  protocol: typeof STORYBOOK_RUNTIME_PROTOCOL
  /**
  Создаёт сессию пакета с возможностями выбранного контекста.

  @param context - Контекст {@link StorybookRuntimeContext}, соответствующий проекции предмета.

  @returns Сессия исполнения {@link StorybookRuntimeSession}, сразу либо после ожидания.
  */
  create(
    context: StorybookRuntimeContext,
  ): StorybookRuntimeSession | Promise<StorybookRuntimeSession>
}>

/**
Проверяет адаптер пакета без зависимости от общего экземпляра его TypeScript-типов.

Модуль потребителя к этому моменту уже загружен. Проверяются точный маркер протокола
и вызываемая фабрика сессии; несовместимый объект отклоняется до передачи
возможностей принимающей страницы.

@param value - Загруженное значение адаптера.

@returns Тот же объект как {@link StorybookRuntimeAdapter} после проверки.

@throws Ошибка типа при неподдерживаемом маркере, недоступном свойстве,
необъектном значении или отсутствующей функции `create`.
*/
export function validateStorybookRuntimeAdapter(value: unknown): StorybookRuntimeAdapter {
  const runtime = requireObject(value, "Storybook runtime")
  const protocol = readProperty(runtime, "protocol", "Storybook runtime")
  if (protocol !== STORYBOOK_RUNTIME_PROTOCOL) {
    throw new TypeError(
      `Unsupported Storybook runtime protocol: ${describeValue(protocol)}`,
    )
  }
  requireMethod(runtime, "create", "Storybook runtime")
  return runtime as StorybookRuntimeAdapter
}

/**
Проверяет сессию, возвращённую вызовом `runtime.create(context)`.

Метод `update` необязателен. Остальные методы жизненного цикла обязательны,
чтобы принимающая сторона могла заменить историю и освободить сессию.
Собственное поле `styleSheets` у сессии не поддерживается.

@param value - Созданная сессия исполнения.

@returns Тот же объект как {@link StorybookRuntimeSession} после проверки.

@throws Ошибка типа при недопустимом объекте, поле `styleSheets`,
невызываемом методе или недоступном для чтения свойстве.
*/
export function validateStorybookRuntimeSession(value: unknown): StorybookRuntimeSession {
  const session = requireObject(value, "Storybook runtime session")
  if (Object.hasOwn(session, "styleSheets")) {
    throw new TypeError("Storybook runtime session.styleSheets is not supported; declare authorStyleSheets or use compiled component CSS")
  }
  requireMethod(session, "mount", "Storybook runtime session")
  const update = readProperty(session, "update", "Storybook runtime session")
  if (update !== undefined && typeof update !== "function") {
    throw new TypeError("Storybook runtime session.update must be a function when provided")
  }
  requireMethod(session, "unmount", "Storybook runtime session")
  requireMethod(session, "dispose", "Storybook runtime session")
  return session as StorybookRuntimeSession
}

/**
Проверяет, что значение является ненулевым объектом, а не массивом.
*/
function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

/**
Проверяет наличие вызываемого метода с указанным именем.
*/
function requireMethod(
  value: Record<string, unknown>,
  key: string,
  label: string,
): void {
  if (typeof readProperty(value, key, label) !== "function") {
    throw new TypeError(`${label}.${key} must be a function`)
  }
}

/**
Читает свойство и сохраняет исходную ошибку чтения как причину ошибки типа.
*/
function readProperty(
  value: Record<string, unknown>,
  key: string,
  label: string,
): unknown {
  try {
    return value[key]
  } catch (error) {
    throw new TypeError(`${label}.${key} could not be read`, {cause: error})
  }
}

/**
Форматирует значение маркера для диагностического сообщения.
*/
function describeValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value)
  return String(value)
}
