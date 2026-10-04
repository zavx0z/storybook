import type {
  Document,
  HTMLDivElement,
  HTMLElement,
  Node,
} from "@zavx0z/dom"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import type {WebCatalog} from "@web/catalog"
import type {WorkbenchViewProps} from "./view"

export type WorkbenchNavigationItem = WebCatalog.Input["items"][number]
export type WorkbenchNavigationGroup = Parameters<WebCatalog.Input["onGroupToggle"]>[0]
export type NavigationExpansion = NonNullable<WebCatalog.Input["navigationExpansion"]>

/**
Виды встроенных секций инспектора: свойства, исходник, события, диагностика,
DOM, раскладка, поверхность отображения и справочные сведения.
*/
export type WorkbenchStandardWidgetKind =
  | "props"
  | "source"
  | "events"
  | "diagnostics"
  | "dom"
  | "layout"
  | "display"
  | "reference"

/**
Регистрация встроенной секции инспектора.

@property id - Идентификатор секции в реестре инспектора.

@property kind - Вид встроенной секции {@link WorkbenchStandardWidgetKind}.

@property label - Короткая подпись вкладки секции.

@property title - Полное название секции.

@property [iconSrc] - Адрес изображения значка.
*/
export type WorkbenchInspectorStandardWidgetRegistration = Readonly<{
  id: string
  kind: WorkbenchStandardWidgetKind
  label: string
  title: string
  iconSrc?: string
}>

/**
Регистрация авторского компонента в инспекторе.

@property id - Идентификатор секции в реестре инспектора.

@property kind - Признак авторского компонента `custom`.

@property label - Короткая подпись вкладки секции.

@property title - Полное название секции.

@property [iconSrc] - Адрес изображения значка.

@property [wrapInPanel] - Значение `false` оставляет собственную шапку компонента
без дополнительной сворачиваемой панели.

@property component - Скомпилированный компонент, принимающий {@link WorkbenchInspectorCustomWidgetProps}.
*/
export type WorkbenchInspectorCustomWidgetRegistration = Readonly<{
  id: string
  kind: "custom"
  label: string
  title: string
  iconSrc?: string
  wrapInPanel?: boolean
  component: CompiledTemplate<WorkbenchInspectorCustomWidgetProps>
}>

/**
Свойства авторского компонента, встроенного в инспектор.

Раскрытие вложенных строк принадлежит рабочему пространству инспектора,
а не временно смонтированному компоненту. Оно сохраняется при переходе
на другую вкладку и возврате в то же рабочее пространство.

@property value - Значение, связанное с регистрацией текущей секции.

@property expandedKeys - Сохранённые идентификаторы раскрытых строк вложенной структуры.
*/
export type WorkbenchInspectorCustomWidgetProps = Readonly<{
  value: unknown
  expandedKeys: readonly string[]
  /**
  Сохраняет следующий набор раскрытых строк текущего рабочего пространства.

  @param keys - Идентификаторы строк, которые остаются раскрытыми.
  */
  onExpandedChange(keys: readonly string[]): void
}>

/**
Регистрация секции инспектора: встроенный вид либо авторский компонент.
*/
export type WorkbenchInspectorWidgetRegistration =
  | WorkbenchInspectorStandardWidgetRegistration
  | WorkbenchInspectorCustomWidgetRegistration

/**
Контекст инспектора одного рабочего пространства представления.

@property [packageId] - Точный идентификатор пакета. Адресные root и Repo контексты не объявляют пакет.

@property subjectId - Предметный идентификатор показываемой сущности.

@property [workspaceId] - Стабильный ключ маршрута для независимого сохранённого состояния вкладки.

@property widgetIds - Идентификаторы доступных секций в порядке показа.
*/
export type WorkbenchInspectorSubject = Readonly<{
  packageId?: string
  subjectId: string
  workspaceId?: string
  widgetIds: readonly string[]
}>

/**
Значения секций инспектора, индексированные идентификаторами их регистраций.
Форму каждого значения определяет соответствующая секция.
*/
export type WorkbenchInspectorValues = Readonly<Record<string, unknown>>

/** Адрес и транспорт чат-секции текущего представления Workbench. */
export type WorkbenchChatContext = Readonly<{
  address: string
  label: string
  fetcher?: typeof fetch
}>

/**
Один адресуемый элемент навигационной цепочки.

@property id - Идентификатор элемента цепочки.

@property label - Отображаемое название.

@property [iconSrc] - Адрес изображения значка.

@property route - Маршрут, передаваемый при выборе.

@property [urlPath] - Публичный путь URL при его наличии.

@property [title] - Дополнительное описание элемента.

@property [disabled] - Признак недоступного перехода.
*/
export type WorkbenchBreadcrumb = Readonly<{
  id: string
  label: string
  iconSrc?: string
  route: string
  urlPath?: string
  title?: string
  disabled?: boolean
}>

/**
Адресуемая вкладка; маршрут передаётся принимающей стороне вместе с выбором.

@property id - Идентификатор вкладки.

@property label - Отображаемое название вкладки.

@property route - Маршрут выбранного представления.

@property [title] - Дополнительное описание вкладки.

@property [disabled] - Признак недоступной вкладки.
*/
export type WorkbenchTabItem = Readonly<{
  id: string
  label: string
  route: string
  title?: string
  disabled?: boolean
}>

/**
Содержимое строки состояния рабочей области.

@property lead - Основной текст состояния.

@property owner - Текст о текущем владельце содержимого.

@property detail - Дополнительные сведения о состоянии.

@property [breadcrumbs] - Навигационная цепочка текущего места.
*/
export type WorkbenchStatus = Readonly<{
  lead: string
  owner: string
  detail: string
  breadcrumbs?: readonly WorkbenchBreadcrumb[]
}>

/**
Назначение проекции: `display` — поверхность отображения, `hud` — экранный слой,
`space` — общее трёхмерное пространство страницы.
*/
export type WorkbenchPresentationProjection = "display" | "hud" | "space"

/**
Семантическое содержимое и выбранное место его отображения.

@property node - Узел содержимого либо `null`, когда содержимое отсутствует.

@property projection - Назначение проекции {@link WorkbenchPresentationProjection}.
*/
export type WorkbenchPresentation = Readonly<{
  node: Node | null
  projection: WorkbenchPresentationProjection
}>

/**
Согласованное обновление содержимого просмотра и соответствующего инспектора.

@property label - Название представления.

@property presentation - Публикуемый узел и его проекция.

@property inspectorSubject - Контекст инспектора либо `null`, когда он не нужен.

@property inspectorValues - Значения секций, относящиеся к тому же содержимому.
*/
export type WorkbenchPresentationUpdate = Readonly<{
  label: string
  presentation: WorkbenchPresentation
  inspectorSubject: WorkbenchInspectorSubject | null
  inspectorValues: WorkbenchInspectorValues
  chat?: WorkbenchChatContext
}>

/**
Состояние управления подключёнными областями каталога.

@property pending - Признак незавершённой операции управления.

@property error - Текст ошибки операции.

@property removableIds - Идентификаторы записей каталога, доступных для отключения.
*/
export type WorkbenchCatalogManagement = NonNullable<WebCatalog.Input["management"]>

/**
Действие пользователя по подключению или отключению области каталога.

@property action - Вид действия: `attach` или `detach`.

@property [value] - Значение, передаваемое обработчику выбранного действия.
*/
export type WorkbenchCatalogAction = Parameters<WebCatalog.Input["onAction"]>[0]

/**
Типизированные адреса данных, которыми принимающая сторона управляет рабочей областью.

@property title - Общий заголовок рабочей области.

@property projectName - Имя текущего Project для окна каталога и домашней ссылки.
До загрузки каталога остаётся пустым.

@property catalog.management - Состояние управления каталогом либо `null`.

@property catalog.label - Название каталога.

@property catalog.search - Текущий поисковый текст каталога.

@property catalog.items - Элементы навигации каталога.

@property catalog.active - Идентификатор выбранного элемента каталога либо `null`.

@property preview.label - Название области просмотра.

@property presentation - Публикуемое семантическое содержимое и его проекция.

@property tabs.label - Название области вкладок.

@property tabs.items - Адресуемые вкладки в порядке показа.

@property tabs.active - Идентификатор выбранной вкладки либо `null`.

@property inspector.registry - Регистрации доступных секций инспектора.

@property inspector.subject - Контекст текущего инспектора либо `null`.

@property inspector.values - Значения зарегистрированных секций.

@property status - Содержимое строки состояния.
*/
export type WorkbenchAddressMap = Readonly<{
  title: string
  projectName: string
  "catalog.management": WorkbenchCatalogManagement | null
  "catalog.label": string
  "catalog.search": string
  "catalog.items": readonly WorkbenchNavigationItem[]
  "catalog.active": string | null
  "preview.label": string
  presentation: WorkbenchPresentation
  "tabs.label": string
  "tabs.items": readonly WorkbenchTabItem[]
  "tabs.active": string | null
  "inspector.registry": readonly WorkbenchInspectorWidgetRegistration[]
  "inspector.subject": WorkbenchInspectorSubject | null
  "inspector.values": WorkbenchInspectorValues
  status: WorkbenchStatus
}>

/**
Один адрес данных из {@link WorkbenchAddressMap}, определяющий тип читаемого или записываемого значения.
*/
export type WorkbenchAddress = keyof WorkbenchAddressMap

/**
Управление данными и жизненным циклом рабочей области.

Адрес определяет тип значения через {@link WorkbenchAddressMap}; согласованное
обновление просмотра и инспектора передаётся как {@link WorkbenchPresentationUpdate}.
*/
/** Пользовательские настройки Inspector без DOM, обработчиков и данных исполняемого сценария. */
export type WorkbenchUserState = Readonly<{
  inspector: readonly Readonly<{
    subject: string
    selectedId: string
    query: string
    expanded: readonly (readonly [string, boolean])[]
    treeExpanded: readonly (readonly [string, readonly string[]])[]
  }>[]
}>

export type WorkbenchController = Readonly<{
  /** Снимает пользовательские настройки перед заменой общей оболочки. */
  captureUserState(): WorkbenchUserState
  /**
  Читает текущее значение по типизированному адресу.

  @param address - Адрес данных рабочей области.

  @returns Значение, соответствующее выбранному адресу.
  */
  read<Address extends WorkbenchAddress>(address: Address): WorkbenchAddressMap[Address]
  /**
  Записывает значение одного адреса рабочей области.

  @param address - Адрес изменяемых данных.

  @param value - Новое значение типа, заданного выбранным адресом.
  */
  update<Address extends WorkbenchAddress>(
    address: Address,
    value: WorkbenchAddressMap[Address],
  ): void
  /**
  Публикует согласованное содержимое просмотра, контекст инспектора и значения его секций.
  */
  present(value: WorkbenchPresentationUpdate): void
  /**
  Возвращает идентификатор выбранной секции инспектора либо `null`.
  */
  selectedInspector(): string | null
  /**
  Выбирает секцию инспектора по идентификатору; `null` обозначает отсутствие выбора.
  */
  selectInspector(id: string | null): void
  /**
  Освобождает ресурсы контроллера рабочей области.
  */
  dispose(): void
}>

/**
Стабильные семантические узлы рабочей области, созданные одним {@link ComponentRoot}.

@property root - Корневой элемент рабочей области.

@property body - Основной контейнер областей.

@property catalog - Область каталога.

@property catalogItems - Контейнер элементов каталога.

@property preview - Область просмотра.

@property previewHost - Контейнер размещения содержимого просмотра.

@property displayHost - Контейнер проекции поверхности отображения.

@property hudHost - Контейнер экранной проекции.

@property spaceHost - Контейнер пространственной проекции.

@property tabs - Область вкладок.

@property tabItems - Контейнер элементов вкладок.

@property inspectorHost - Контейнер инспектора.

@property status - Узел строки состояния.
*/
export type WorkbenchElements = Readonly<{
  root: HTMLDivElement
  body: HTMLDivElement
  catalog: HTMLElement
  catalogItems: HTMLElement
  preview: HTMLElement
  previewHost: HTMLElement
  displayHost: HTMLElement
  hudHost: HTMLElement
  spaceHost: HTMLElement
  tabs: HTMLElement
  tabItems: HTMLDivElement
  inspectorHost: HTMLDivElement
  status: HTMLElement
}>

/**
Созданная рабочая область, её семантические узлы и управляющий интерфейс.

@property document - Семантический документ рабочей области.

@property element - Корневой элемент рабочей области.

@property elements - Именованные узлы {@link WorkbenchElements}.

@property controller - Управление состоянием через {@link WorkbenchController}.
*/
export type Workbench = Readonly<{
  document: Document
  element: HTMLDivElement
  elements: WorkbenchElements
  controller: WorkbenchController
  /** Снимок для представлений того же Workbench в Display и HUD. */
  getSnapshot(): WorkbenchViewProps
  subscribe(listener: () => void): () => boolean
  /** Имена событий, которые этот Workbench передаёт принимающей странице. */
  events: Readonly<{
    navigate: string
    search: string
    tab: string
    inspector: string
    groupToggle: string
    catalogAction: string
  }>
  /** Включает собственные секции Workbench и предоставленные предметные секции. */
  configureInspector(widgets?: readonly WorkbenchInspectorWidgetRegistration[]): void
  /** Обновляет адресный Chat в текущем Inspector без замены содержимого Preview. */
  setChatContext(context: WorkbenchChatContext, subject?: WorkbenchInspectorSubject | null, values?: WorkbenchInspectorValues): void
  /**
  Передаёт новое значение типизированного адреса контроллеру рабочей области.
  */
  update<Address extends WorkbenchAddress>(
    address: Address,
    value: WorkbenchAddressMap[Address],
  ): void
  /**
  Передаёт контроллеру согласованное обновление просмотра и инспектора.
  */
  present(value: WorkbenchPresentationUpdate): void
  /**
  Возвращает текущий выбор секции инспектора через контроллер.
  */
  selectedInspector(): string | null
  /**
  Передаёт контроллеру выбор секции инспектора; `null` обозначает отсутствие выбора.
  */
  selectInspector(id: string | null): void
  /**
  Завершает жизненный цикл созданной рабочей области.
  */
  dispose(): void
}>

/**
Изменяемое внутреннее состояние рабочей области с теми же адресами и типами, что у {@link WorkbenchAddressMap}.
*/
export type WorkbenchViewState = {
  -readonly [Address in WorkbenchAddress]: WorkbenchAddressMap[Address]
}
