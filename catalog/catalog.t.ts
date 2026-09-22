/**
Нормализованное содержание подключённых проектов и пакетов.

Обнаружение проверяет владение и пути, затем передаёт этот контракт каталогу.
Граф, подготовка сборки и представление не разбирают декларации источника.
Обнаружение не исполняет код владельца.
Массивы сохраняют порядок владельца, а `source` указывает на точный исходник.
Формат `source.pointer` определяет источник: средство чтения JSON использует JSON Pointer.

Структурный `spec/deps.spec.ts` добавляет данные зависимостей к обнаруженному модулю.
Исходник теста разбирается без исполнения; виды узлов каталога сохраняются.

@see [Архитектура Storybook](../ARCHITECTURE.md)
@packageDocumentation
*/

import type {
  EXTERNAL_STORYBOOK_SCHEMA_VERSION,
  STORYBOOK_STANDARD_WIDGET_IDS,
  STORYBOOK_WIDGET_CONTRIBUTION_PROTOCOL,
  STORYBOOK_STORY_PRESENTATION_PROTOCOL,
} from "./protocol.ts"

/**
Точный исходник узла и положение в формате предоставившего его источника.

@property path - Путь к исходному файлу.

@property pointer - Положение внутри исходника. Формат задаёт механизм обнаружения;
для JSON используется JSON Pointer.
*/
export type StorybookSourceReference = Readonly<{
  path: string
  pointer: string
}>

/**
Идентификатор встроенной секции из {@link STORYBOOK_STANDARD_WIDGET_IDS}.
*/
export type StorybookStandardWidgetId = typeof STORYBOOK_STANDARD_WIDGET_IDS[number]
/**
Проекция истории: поверхность отображения `display`, экранный слой `hud` или пространство `space`.
*/
export type StorybookStoryProjection = "display" | "hud" | "space"

/**
Вид подключённого владельца каталога: рабочее пространство, проект или пакет.
*/
export type StorybookCatalogScopeKind = "workspace" | "project" | "package"

/**
Именованная группа представлений в каталоге.

@property id - Идентификатор группы.

@property label - Отображаемое название группы.
*/
export type StorybookPresentationGroup = Readonly<{
  id: string
  label: string
}>

/**
Разрешённый модуль и конкретный экспорт, используемый потребителем каталога.

@property path - Путь к модулю.

@property exportName - Имя выбранного экспорта.
*/
export type StorybookModuleReference = Readonly<{
  path: string
  exportName: string
}>

/**
Назначение ресурса истории: тестовая заготовка, тест, медиа, справочный материал,
свидетельство проверки или вспомогательный ресурс.
*/
export type StorybookResourceKind =
  | "fixture"
  | "test"
  | "media"
  | "reference"
  | "evidence"
  | "asset"

/**
Ресурс, принадлежащий варианту истории.

@property kind - Назначение ресурса {@link StorybookResourceKind}.

@property path - Путь к ресурсу.
*/
export type StorybookResource = Readonly<{
  kind: StorybookResourceKind
  path: string
}>

/**
Разрешённая авторская таблица стилей с данными о владельце и содержимом.

@property specifier - Исходное обозначение таблицы стилей в декларации.

@property path - Разрешённый путь к файлу стилей.

@property ownerRoot - Корень пакета — владельца таблицы стилей.

@property ownerPackageJsonPath - Путь к манифесту пакета-владельца.

@property contentDigest - Контрольный отпечаток содержимого стилей.
*/
export type StorybookAuthorStyleSheet = Readonly<{
  specifier: string
  path: string
  ownerRoot: string
  ownerPackageJsonPath: string
  contentDigest: string
}>

/**
Подключение встроенной секции инспектора декларацией пакета.

@property id - Идентификатор встроенной секции.

@property kind - Признак встроенной секции `standard`.
*/
export type StorybookStandardWidgetContribution = Readonly<{
  id: StorybookStandardWidgetId
  kind: "standard"
}>

/**
Подключение авторского компонента инспектора декларацией пакета.

@property id - Идентификатор подключаемой секции.

@property kind - Признак компонентной секции `component`.

@property label - Отображаемое название секции.

@property module - Модуль и экспорт компонента {@link StorybookModuleReference}.
*/
export type StorybookComponentWidgetContribution = Readonly<{
  id: string
  kind: "component"
  label: string
  module: StorybookModuleReference
}>

/**
Подключение встроенной секции либо авторского компонента инспектора; варианты различаются по `kind`.
*/
export type StorybookWidgetContribution =
  | StorybookStandardWidgetContribution
  | StorybookComponentWidgetContribution

/**
Объявленные пакетом секции инспектора в едином формате.

@property protocol - Маркер {@link STORYBOOK_WIDGET_CONTRIBUTION_PROTOCOL}.

@property items - Подключаемые секции в порядке декларации.
*/
export type StorybookWidgetContributions = Readonly<{
  protocol: typeof STORYBOOK_WIDGET_CONTRIBUTION_PROTOCOL
  items: readonly StorybookWidgetContribution[]
}>

/**
Правила размещения истории и состав относящегося к ней инспектора.

@property protocol - Маркер {@link STORYBOOK_STORY_PRESENTATION_PROTOCOL}.

@property projection - Выбранная проекция истории.

@property widgets - Идентификаторы секций инспектора в порядке показа.
*/
export type StorybookStoryPresentation = Readonly<{
  protocol: typeof STORYBOOK_STORY_PRESENTATION_PROTOCOL
  projection: StorybookStoryProjection
  widgets: readonly string[]
}>

/**
Один объявленный вариант использования предмета.

@property id - Идентификатор варианта.

@property label - Отображаемое название.

@property group - Группа представлений либо `null`.

@property route - Маршрут варианта в каталоге пакета.

@property module - Исполняемый модуль и экспорт либо `null` при их отсутствии.

@property resources - Ресурсы варианта.

@property presentation - Проекция и секции инспектора варианта.

@property source - Исходная декларация варианта.
*/
export type StorybookVariant = Readonly<{
  id: string
  label: string
  group: StorybookPresentationGroup | null
  route: string
  module: StorybookModuleReference | null
  resources: readonly StorybookResource[]
  presentation: StorybookStoryPresentation
  source: StorybookSourceReference
}>

/**
Предмет каталога с собственной документацией и вариантами использования.

@property [directory] - Структурный модуль относительно пакета; его привязка
не зависит от экспортов и имён программного интерфейса.

@property id - Идентификатор предмета.

@property route - Маршрут предмета.

@property kind - Предметный вид сущности.

@property label - Отображаемое название.

@property apiName - Имя в программном интерфейсе либо `null`.

@property readmePath - Путь к README предмета либо `null`.

@property tags - Поисковые метки.

@property aliases - Дополнительные имена для поиска.

@property presentation - Общие правила представления предмета.

@property variants - Варианты использования в порядке декларации.

@property source - Исходная декларация предмета.
*/
export type StorybookSubject = Readonly<{
  directory?: string
  id: string
  route: string
  kind: string
  label: string
  apiName: string | null
  readmePath: string | null
  tags: readonly string[]
  aliases: readonly string[]
  presentation: StorybookStoryPresentation
  variants: readonly StorybookVariant[]
  source: StorybookSourceReference
}>

/**
Категория, объединяющая связанные предметы каталога.

@property id - Идентификатор категории.

@property route - Маршрут категории.

@property label - Отображаемое название.

@property kind - Предметный вид категории либо `null`.

@property apiName - Имя в программном интерфейсе либо `null`.

@property group - Группа представлений либо `null`.

@property subjects - Предметы категории в порядке декларации.

@property source - Исходная декларация категории.
*/
export type StorybookCategory = Readonly<{
  id: string
  route: string
  label: string
  kind: string | null
  apiName: string | null
  group: StorybookPresentationGroup | null
  subjects: readonly StorybookSubject[]
  source: StorybookSourceReference
}>

/**
Нормализованное содержимое каталога одного пакета.

@property schemaVersion - Версия схемы {@link EXTERNAL_STORYBOOK_SCHEMA_VERSION}.

@property sourcePaths - Файлы, изменение которых требует повторного обнаружения состава каталога.

@property digest - Контрольный отпечаток каталога.

@property categories - Категории пакета в порядке декларации.
*/
export type StorybookPackageCatalog = Readonly<{
  schemaVersion: typeof EXTERNAL_STORYBOOK_SCHEMA_VERSION
  sourcePaths: readonly string[]
  digest: string
  categories: readonly StorybookCategory[]
}>

/**
Документация входного модуля, извлечённая из исходника.

@property sourcePath - Путь к исходному модулю.

@property sourceDigest - Контрольный отпечаток исходника.

@property markdown - Извлечённое описание в формате Markdown.
*/
export type StorybookModuleDocumentation = Readonly<{
  sourcePath: string
  sourceDigest: string
  markdown: string
}>

/**
Разобранное описание одного направления контракта.

@property direction - Направление: входные данные `input` либо выходные данные `output`.

@property document - Структурированная модель документа, возвращённая разборщиком TypeDoc.
*/
export type StorybookContractDocument = Readonly<{
  direction: "input" | "output"
  document: import("@webxr/typedoc/parser/contract/output").AnalyzeTypeDocOutput["document"]
}>

/**
Документация существующих файлов `contract/input.ts` и `contract/output.ts` одного модуля.

@property documents - Разобранные документы доступных направлений контракта.

@property sources - Исходники контрактов: путь `sourcePath` и контрольный отпечаток `sourceDigest`.
*/
export type StorybookContractDocumentation = Readonly<{
  documents: readonly StorybookContractDocument[]
  sources: readonly Readonly<{sourcePath: string; sourceDigest: string}>[]
}>

/**
Ожидаемый состав зависимостей из `test.each`, а не результат выполнения теста.

@property name - Название варианта проверки зависимостей.

@property file - Проверяемый исходный файл.

@property testName - Название содержащего теста.

@property graph - Ожидаемый граф компонентов: `uses` задаёт используемые компоненты,
`elements` — нативные элементы.
*/
export type StorybookDependencyCase = Readonly<{
  name: string
  file: string
  testName: string
  graph: Readonly<Record<string, Readonly<{uses: readonly string[], elements: readonly string[]}>>>
}>

/**
Проверенный структурный источник зависимостей конкретного модуля.

@property sourcePath - Путь к файлу спецификации зависимостей.

@property sourceDigest - Контрольный отпечаток исходника.

@property cases - Извлечённые ожидаемые варианты зависимостей.
*/
export type StorybookDependencySpec = Readonly<{
  sourcePath: string
  sourceDigest: string
  cases: readonly StorybookDependencyCase[]
}>

/**
Найденные файлы сценариев; наличие не означает их разбор или выполнение.

@property sourcePaths - Пути к файлам `scenario.spec.ts` или `scenario.spec.tsx`.
*/
export type StorybookScenarioSpec = Readonly<{
  sourcePaths: readonly string[]
}>

/**
Директория, категория или модуль, определённые по размещению, а не по экспортам.

@property path - Физический путь директории.

@property relativePath - Путь относительно пакета.

@property name - Имя директории.

@property [parentRelativePath] - Относительный путь родительской директории.

@property [structuralRole] - Обнаруженная структурная роль: категория, модуль или обычная директория.

@property readmePath - Путь к README либо `null`.

@property [moduleDocumentation] - Документация входного модуля при её наличии.

@property [dependencySpec] - Спецификация зависимостей при её наличии.

@property [contractDocumentation] - Документы входа и выхода при их наличии.

@property [scenarioSpec] - Найденные файлы сценариев при их наличии.
*/
export type StorybookDirectory = Readonly<{
  path: string
  relativePath: string
  name: string
  parentRelativePath?: string
  structuralRole?: "category" | "module" | "directory"
  readmePath: string | null
  moduleDocumentation?: StorybookModuleDocumentation
  dependencySpec?: StorybookDependencySpec
  contractDocumentation?: StorybookContractDocumentation
  scenarioSpec?: StorybookScenarioSpec
}>

/**
Общие сведения о подключённом владельце каталога.

@property [resolutionError] - Локальная ошибка обнаружения. Содержимое остаётся последним
проверенным снимком либо пустым описанием владельца.

@property [recoveryPaths] - Пути, наблюдаемые для восстановления после ошибки обнаружения.

@property [structurePaths] - Пути структуры владельца для обнаружения пакетов
и изменений необязательных манифестов.

@property [legacyUrls] - Прежние адреса навигации только для переноса URL;
они не определяют идентичность владельца.

@property [directories] - Обнаруженные директории владельца.

@property schemaVersion - Версия схемы каталога.

@property canonicalId - Канонический идентификатор владельца.

@property id - Идентификатор области в каталоге.

@property label - Отображаемое название.

@property source - Исходная декларация владельца.

@property scopeRoot - Физический корень области.

@property readmePath - Путь к README либо `null`.

@property digest - Контрольный отпечаток области каталога.
*/
type StorybookCatalogScopeBase = Readonly<{
  resolutionError?: string
  recoveryPaths?: readonly string[]
  structurePaths?: readonly string[]
  legacyUrls?: readonly string[]
  directories?: readonly StorybookDirectory[]
  schemaVersion: typeof EXTERNAL_STORYBOOK_SCHEMA_VERSION
  canonicalId: string
  id: string
  label: string
  source: StorybookSourceReference
  scopeRoot: string
  readmePath: string | null
  digest: string
}>

/**
Рабочее пространство с подключёнными проектами и общими сведениями владельца.

@property kind - Вид области `workspace`.

@property projectIds - Идентификаторы проектов рабочего пространства.
*/
export type StorybookWorkspace = StorybookCatalogScopeBase & Readonly<{
  kind: "workspace"
  projectIds: readonly string[]
}>

/**
Проект с подключёнными пакетами и общими сведениями владельца.

@property kind - Вид области `project`.

@property packageIds - Идентификаторы пакетов проекта.
*/
export type StorybookProject = StorybookCatalogScopeBase & Readonly<{
  kind: "project"
  packageIds: readonly string[]
}>

/**
Пакет как самостоятельный владелец исполняемого содержимого и документации.

@property kind - Вид области `package`.

@property [scenarioSpec] - Найденные сценарии самого пакета.

@property [contractDocumentation] - Документы контракта пакета.

@property [dependencySpec] - Спецификация зависимостей пакета.

@property [packageIds] - Вложенные пакеты рабочего пространства. Их исполняемое содержимое
остаётся в независимом владении каждого пакета.

@property packageJsonPath - Путь к манифесту пакета.

@property packageName - Имя пакета из манифеста.

@property authorStyleSheets - Разрешённые авторские таблицы стилей.

@property widgetContributions - Объявленные секции инспектора либо `null`.

@property runtime - Модуль исполняемого адаптера пакета либо `null`.

@property catalog - Собственный каталог категорий и предметов либо `null`.
*/
export type StorybookPackage = StorybookCatalogScopeBase & Readonly<{
  kind: "package"
  scenarioSpec?: StorybookScenarioSpec
  contractDocumentation?: StorybookContractDocumentation
  dependencySpec?: StorybookDependencySpec
  packageIds?: readonly string[]
  packageJsonPath: string
  packageName: string
  authorStyleSheets: readonly StorybookAuthorStyleSheet[]
  widgetContributions: StorybookWidgetContributions | null
  runtime: StorybookModuleReference | null
  catalog: StorybookPackageCatalog | null
}>

/**
Одна область каталога: рабочее пространство, проект, пакет либо недоступный
владелец с сохранёнными общими сведениями. Вариант различается по `kind`.
*/
export type StorybookCatalogScope =
  | StorybookWorkspace
  | StorybookProject
  | StorybookPackage
  | (StorybookCatalogScopeBase & Readonly<{kind: "unavailable"}>)

/**
Единый нормализованный каталог всех выбранных корней.

@property schemaVersion - Версия схемы каталога.

@property rootIds - Идентификаторы корневых областей в порядке подключения.

@property scopes - Области каталога {@link StorybookCatalogScope}.
*/
export type StorybookCatalog = Readonly<{
  schemaVersion: typeof EXTERNAL_STORYBOOK_SCHEMA_VERSION
  rootIds: readonly string[]
  scopes: readonly StorybookCatalogScope[]
}>

/**
Читает выбранные корни в один кандидат каталога без изменения реестра.

Источник проверяет существование, владение и неоднозначность файлов.
При обновлении локальная ошибка возвращается у соответствующей области
с последним проверенным содержимым или пустым описанием владельца.
Соседние области обновляются независимо. Без предыдущего каталога
действует строгая проверка нового подключения.
Новый способ обнаружения подключается через этот контракт, без второго реестра
или рабочей области Storybook.

@param roots - Выбранные корни обнаружения.

@param previous - Предыдущий каталог для сохранения проверенных данных при локальной ошибке.

@returns Кандидат {@link StorybookCatalog}, не применённый к реестру.
*/
export type StorybookCatalogResolver = (
  roots: readonly string[],
  previous?: StorybookCatalog,
) => Promise<StorybookCatalog>
