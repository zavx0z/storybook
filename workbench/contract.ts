import type {
  Document,
  HTMLDivElement,
  HTMLInputElement,
  HTMLElement,
  Node,
} from "@zavx0z/dom"
import type {ComponentRoot} from "@zavx0z/component"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import type {
  WorkbenchNavigationGroup,
  WorkbenchNavigationItem,
} from "./navigation/model.ts"

/**
Имена семантических событий, передаваемых из рабочей области принимающей стороне.
*/
export const WORKBENCH_EVENTS = Object.freeze({
  navigate: "storybooknavigate",
  search: "storybooksearch",
  tab: "storybooktab",
  inspector: "storybookinspector",
  groupToggle: "storybookgrouptoggle",
  catalogAction: "storybookcatalogaction",
} as const)

/**
Маркер версии контракта раскладки рабочей области Storybook.
*/
export const WORKBENCH_LAYOUT_PROTOCOL = "workbench-layout/2" as const

/**
Именованные области раскладки: каталог, содержание, вкладки, просмотр, инспектор и строка состояния.
*/
export const WORKBENCH_REGIONS = Object.freeze([
  "catalog",
  "secondary",
  "tabs",
  "preview",
  "inspector",
  "status",
] as const)

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

@property packageId - Точный идентификатор пакета, разделяющий состояния разных пакетов.

@property subjectId - Предметный идентификатор показываемой сущности.

@property [workspaceId] - Стабильный ключ маршрута для независимого сохранённого состояния вкладки.

@property widgetIds - Идентификаторы доступных секций в порядке показа.
*/
export type WorkbenchInspectorSubject = Readonly<{
  packageId: string
  subjectId: string
  workspaceId?: string
  widgetIds: readonly string[]
}>

/**
Значения секций инспектора, индексированные идентификаторами их регистраций.
Форму каждого значения определяет соответствующая секция.
*/
export type WorkbenchInspectorValues = Readonly<Record<string, unknown>>

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
}>

/**
Переданные принимающей стороной узлы для размещения проекций.

@property [display] - Узел размещения на поверхности отображения.

@property [space] - Узел размещения в общем пространстве.
*/
export type WorkbenchProjectionHosts = Readonly<{
  display?: Node
  space?: Node
}>

/**
Состояние управления подключёнными областями каталога.

@property pending - Признак незавершённой операции управления.

@property error - Текст ошибки операции.

@property removableIds - Идентификаторы записей каталога, доступных для отключения.
*/
export type WorkbenchCatalogManagement = Readonly<{
  pending: boolean
  error: string
  removableIds: readonly string[]
}>

/**
Действие пользователя по подключению или отключению области каталога.

@property action - Вид действия: `attach` или `detach`.

@property [value] - Значение, передаваемое обработчику выбранного действия.
*/
export type WorkbenchCatalogAction = Readonly<{
  action: "attach" | "detach"
  value?: string
}>

/**
Типизированные адреса данных, которыми принимающая сторона управляет рабочей областью.

@property title - Общий заголовок рабочей области.

@property catalog.management - Состояние управления каталогом либо `null`.

@property catalog.label - Название каталога.

@property catalog.search - Текущий поисковый текст каталога.

@property catalog.items - Элементы навигации каталога.

@property catalog.active - Идентификатор выбранного элемента каталога либо `null`.

@property secondary.label - Название дополнительной области содержания.

@property secondary.items - Элементы дополнительной навигации.

@property secondary.active - Идентификатор выбранного дополнительного элемента либо `null`.

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
  "catalog.management": WorkbenchCatalogManagement | null
  "catalog.label": string
  "catalog.search": string
  "catalog.items": readonly WorkbenchNavigationItem[]
  "catalog.active": string | null
  "secondary.label": string
  "secondary.items": readonly WorkbenchNavigationItem[]
  "secondary.active": string | null
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
export type WorkbenchController = Readonly<{
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

@property catalogSearch - Поле поиска в каталоге.

@property catalogItems - Контейнер элементов каталога.

@property secondary - Дополнительная область содержания.

@property secondaryItems - Контейнер дополнительной навигации.

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
  catalogSearch: HTMLInputElement
  catalogItems: HTMLDivElement
  secondary: HTMLElement
  secondaryItems: HTMLDivElement
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
Условия создания рабочей области в существующем семантическом документе.

@property document - Документ, в котором создаётся рабочая область.

@property [parent] - Родительский узел для размещения рабочей области.

@property [projectionHosts] - Внешние узлы проекций {@link WorkbenchProjectionHosts}.

@property [initial] - Начальные значения выбранных адресов {@link WorkbenchAddressMap}.
*/
export type CreateWorkbenchOptions = Readonly<{
  document: Document
  parent?: Node
  projectionHosts?: WorkbenchProjectionHosts
  initial?: Partial<WorkbenchAddressMap>
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

export type {
  WorkbenchNavigationGroup,
  WorkbenchNavigationItem,
} from "./navigation/model.ts"
