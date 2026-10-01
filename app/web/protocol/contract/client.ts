import type {PackageGraphCreate} from "@package-graph/create"
import type {PackageSession} from "@package/session"

type GraphNode = PackageGraphCreate.Output["nodes"][number]
type ExternalStorybookGraphNodeKind = GraphNode["kind"]
type StorybookPackageSessionSnapshot = ReturnType<PackageSession.Output["snapshot"]>
type StorybookPackageBuildState = StorybookPackageSessionSnapshot["buildState"]
type StorybookPackageDiagnostic = StorybookPackageSessionSnapshot["diagnostics"][number]
type StorybookDependencyCase = NonNullable<GraphNode["dependencySpec"]>["cases"][number]
type StorybookContractDocument = NonNullable<GraphNode["contractDocumentation"]>["documents"][number]

/**
Сериализованное представление узла канонического графа для браузера.

@property id - Идентификатор узла графа.

@property kind - Вид узла графа.

@property ownerId - Идентификатор владельца узла.

@property packageId - Идентификатор связанного пакета либо `null`.

@property label - Объявленное название для заголовка и контекста пакета.

@property [directoryName] - Имя директории пакета для дерева; абсолютный путь не передаётся.

@property parentId - Идентификатор родителя либо `null` для корня.

@property childIds - Идентификаторы дочерних узлов в порядке графа.

@property urlPath - Публичный путь URL узла.

@property routePath - Маршрут внутри пакета либо `null`.

@property searchTerms - Слова и имена для поиска узла.

@property [hasModuleDocumentation] - Наличие документации входного модуля.

@property [dependencyCases] - Ожидаемые варианты зависимостей из спецификации.

@property [dependencyRoutePath] - Маршрут просмотра зависимостей.

@property [contractRoutePath] - Маршрут просмотра контракта.

@property [scenariosRoutePath] - Маршрут просмотра сценариев.

@property [contractDocuments] - Разобранные документы входа и выхода.

@property resourceUrl - Адрес чтения ресурса узла.

*/
export type ExternalStorybookClientNode = Readonly<{
  id: string
  kind: ExternalStorybookGraphNodeKind
  ownerId: string
  packageId: string | null
  label: string
  directoryName?: string
  parentId: string | null
  childIds: readonly string[]
  urlPath: string
  routePath: string | null
  searchTerms: readonly string[]
  hasModuleDocumentation?: boolean
  dependencyCases?: readonly StorybookDependencyCase[]
  dependencyRoutePath?: string
  contractRoutePath?: string
  scenariosRoutePath?: string
  contractDocuments?: readonly StorybookContractDocument[]
  resourceUrl: string
}>

/**
Диагностическое сообщение для браузера без внутренних путей владельца.

@property phase - Этап, к которому относится сообщение.

@property message - Текст с заменёнными внутренними путями.
*/
export type ExternalStorybookClientDiagnostic = Readonly<{
  phase: StorybookPackageDiagnostic["phase"]
  message: string
}>

/**
Сводка ревизий, состояния сборки и диагностики одной сессии пакета.

Отсутствующая ревизия обозначается `null`; сборка кандидата сама по себе
не означает его применения к представлениям.

@property packageId - Идентификатор пакета.

@property declarationDigest - Контрольный отпечаток метаданных и структурного графа пакета.
Историческое имя поля не означает наличие проектной декларации Storybook.

@property moduleGraphRevision - Ревизия графа модулей либо `null`.

@property candidateRevision - Текущий кандидат ревизии либо `null`.

@property builtRevision - Собранная ревизия либо `null`.

@property activatingRevision - Ревизия, проходящая применение, либо `null`.

@property activeRevision - Применённая ревизия либо `null`.

@property lastWorkingRevision - Последняя рабочая ревизия для восстановления либо `null`.

@property lastGoodRevision - Последняя успешная ревизия, сохранённая в снимке сессии, либо `null`.

@property buildState - Состояние сборки пакета.

@property diagnostics - Диагностические сообщения для браузера.
*/
export type ExternalStorybookClientPackageSummary = Readonly<{
  packageId: string
  declarationDigest: string
  moduleGraphRevision: string | null
  candidateRevision: string | null
  builtRevision: string | null
  activatingRevision: string | null
  activeRevision: string | null
  lastWorkingRevision: string | null
  lastGoodRevision: string | null
  buildState: StorybookPackageBuildState
  diagnostics: readonly ExternalStorybookClientDiagnostic[]
  warnings?: readonly ExternalStorybookClientDiagnostic[]
  standard?: "transition" | "strict"
}>
