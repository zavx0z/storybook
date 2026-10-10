/**
Нормализованное содержание подключённых пакетов.

Обнаружение проверяет владение и пути, затем передаёт этот контракт каталогу.
Граф, подготовка сборки и представление не разбирают исходные файлы повторно.
Обнаружение не исполняет код владельца.
Массивы сохраняют порядок владельца, а `source` указывает на точный исходник.
`source.pointer` остаётся пустым для физического файла.

Структурный `spec/deps.spec.ts` добавляет данные зависимостей к обнаруженному модулю.
Исходник теста разбирается без исполнения.

@see [Архитектура Storybook](../../../../ARCHITECTURE.md)
@packageDocumentation
*/


/**
Точный исходник узла и положение в формате предоставившего его источника.

@property path - Путь к исходному файлу.

@property pointer - Положение внутри исходника; для физического файла пустое.
*/
export type StorybookSourceReference = Readonly<{
  path: string
  pointer: string
}>

/** Документация входного модуля из контракта владельца пакета. */
export type StorybookModuleDocumentation = NonNullable<ReturnType<typeof import("@zavx0z/storybook-package-documentation").default>>

/**
Разобранное описание одного направления контракта.

@property direction - Роль контракта: входные данные `input`, выходные данные
`output` либо поведенческие слоты `slots`.

@property document - Структурированная модель документа, возвращённая разборщиком TypeDoc.
*/
export type StorybookContractDocument = Readonly<{
  direction: "input" | "output" | "slots"
  /** Точный источник выбранного протокола; прежние сохранённые документы этого поля не имели. */
  sourcePath?: string
  document: import("@zavx0z/immersive/typedoc/parser").AnalyzeTypeDocOutput["document"]
}>

/**
Документация ролей из `contract/index.ts` либо существующих файлов
`contract/input.ts` и `contract/output.ts` одного модуля.

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
Публичная физическая директория, определённая по размещению, а не по экспортам.

@property path - Физический путь директории.

@property relativePath - Путь относительно пакета.

@property name - Имя директории.

@property [parentRelativePath] - Относительный путь родительской директории.

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
  moduleDocumentation?: StorybookModuleDocumentation
  dependencySpec?: StorybookDependencySpec
  contractDocumentation?: StorybookContractDocumentation
  scenarioSpec?: StorybookScenarioSpec
}>

/** Публичный файл входа пакета; условия и протокол относятся к одному исходнику. */
export type StorybookEntry = Readonly<{
  path: string
  relativePath: string
  conditions: readonly (readonly string[])[]
  moduleDocumentation?: StorybookModuleDocumentation
  contractDocumentation?: StorybookContractDocumentation
}>

/**
Общие сведения о подключённом владельце каталога.

@property [resolutionError] - Локальная ошибка обнаружения. Содержимое остаётся последним
проверенным снимком либо пустым описанием владельца.

@property [recoveryPaths] - Пути, наблюдаемые для восстановления после ошибки обнаружения.

@property [structurePaths] - Пути структуры и исходников владельца для обновления каталога.

@property [directories] - Обнаруженные директории владельца.

@property schemaVersion - Версия схемы каталога.

@property canonicalId - Канонический идентификатор владельца.

@property id - Идентификатор области в каталоге.

@property label - Отображаемое название.

@property [description] - Авторское назначение из непосредственного package.json;
отсутствие не заменяется подписью.

@property source - Исходный package.json владельца.

@property scopeRoot - Физический корень области.

@property [moduleDocumentation] - Документация корневого входного модуля при её наличии.

@property digest - Контрольный отпечаток области каталога.
*/
type StorybookCatalogScopeBase = Readonly<{
  resolutionError?: string
  recoveryPaths?: readonly string[]
  structurePaths?: readonly string[]
  directories?: readonly StorybookDirectory[]
  schemaVersion: 1
  canonicalId: string
  id: string
  label: string
  description?: string
  source: StorybookSourceReference
  scopeRoot: string
  moduleDocumentation?: StorybookModuleDocumentation
  digest: string
}>

/**
Пакет как самостоятельный владелец исполняемого содержимого и документации.

@property kind - Вид области `package`.

@property [scenarioSpec] - Найденные сценарии самого пакета.

@property [contractDocumentation] - Документы контракта пакета.

@property [dependencySpec] - Спецификация зависимостей пакета.

@property [packageIds] - Вложенные пакеты workspaces. Их исполняемое содержимое
остаётся в независимом владении каждого пакета.

@property packageJsonPath - Путь к манифесту пакета.

@property packageName - Имя пакета из package.json.
*/
export type StorybookPackage = StorybookCatalogScopeBase & Readonly<{
  kind: "package"
  entries?: readonly StorybookEntry[]
  scenarioSpec?: StorybookScenarioSpec
  contractDocumentation?: StorybookContractDocumentation
  dependencySpec?: StorybookDependencySpec
  packageIds?: readonly string[]
  packageJsonPath: string
  packageName: string
}>

/**
Одна область каталога: пакет либо недоступный владелец с сохранёнными сведениями.
*/
export type StorybookCatalogScope =
  | StorybookPackage
  | (StorybookCatalogScopeBase & Readonly<{kind: "unavailable"}>)
