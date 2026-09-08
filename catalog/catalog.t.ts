/**
Нормализованное содержание подключённых проектов и пакетов.

Обнаружение проверяет владение и пути, затем передаёт этот контракт каталогу.
Граф, подготовка сборки и представление не разбирают декларации источника.
Обнаружение не исполняет код владельца.
Массивы сохраняют порядок владельца, а source указывает на точный исходник.
Формат source.pointer принадлежит источнику: JSON reader использует JSON Pointer.

Контракт сохраняет существующие виды узлов и протоколы представления.
Извлечение структуры TypeScript и исполнение новых видов сценариев сюда
не добавлены.

@see [Архитектура Storybook](../ARCHITECTURE.md)
@packageDocumentation
*/

import type {
  EXTERNAL_STORYBOOK_SCHEMA_VERSION,
  STORYBOOK_STANDARD_WIDGET_IDS,
  STORYBOOK_WIDGET_CONTRIBUTION_PROTOCOL,
  STORYBOOK_STORY_PRESENTATION_PROTOCOL,
} from "./protocol.ts"

/** Точный исходник узла и позиция в формате предоставившего его источника. */
export type StorybookSourceReference = Readonly<{
  path: string
  pointer: string
}>

export type StorybookStandardWidgetId = typeof STORYBOOK_STANDARD_WIDGET_IDS[number]
export type StorybookStoryProjection = "display" | "hud" | "space"

export type StorybookCatalogScopeKind = "workspace" | "project" | "package"

export type StorybookPresentationGroup = Readonly<{
  id: string
  label: string
}>

export type StorybookModuleReference = Readonly<{
  path: string
  exportName: string
}>

export type StorybookResourceKind =
  | "fixture"
  | "test"
  | "media"
  | "reference"
  | "evidence"
  | "asset"

export type StorybookResource = Readonly<{
  kind: StorybookResourceKind
  path: string
}>

export type StorybookAuthorStyleSheet = Readonly<{
  specifier: string
  path: string
  ownerRoot: string
  ownerPackageJsonPath: string
  contentDigest: string
}>

export type StorybookStandardWidgetContribution = Readonly<{
  id: StorybookStandardWidgetId
  kind: "standard"
}>

export type StorybookComponentWidgetContribution = Readonly<{
  id: string
  kind: "component"
  label: string
  module: StorybookModuleReference
}>

export type StorybookWidgetContribution =
  | StorybookStandardWidgetContribution
  | StorybookComponentWidgetContribution

export type StorybookWidgetContributions = Readonly<{
  protocol: typeof STORYBOOK_WIDGET_CONTRIBUTION_PROTOCOL
  items: readonly StorybookWidgetContribution[]
}>

export type StorybookStoryPresentation = Readonly<{
  protocol: typeof STORYBOOK_STORY_PRESENTATION_PROTOCOL
  projection: StorybookStoryProjection
  widgets: readonly string[]
}>

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

export type StorybookSubject = Readonly<{
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

export type StorybookPackageCatalog = Readonly<{
  schemaVersion: typeof EXTERNAL_STORYBOOK_SCHEMA_VERSION
  /** Файлы, изменение которых требует повторного обнаружения состава каталога. */
  sourcePaths: readonly string[]
  digest: string
  categories: readonly StorybookCategory[]
}>

type StorybookCatalogScopeBase = Readonly<{
  /** Scoped discovery failure; content is the last validated snapshot or an empty owner shell. */
  resolutionError?: string
  recoveryPaths?: readonly string[]
  /** Owner structure paths observed for package discovery and optional manifest changes. */
  structurePaths?: readonly string[]
  schemaVersion: typeof EXTERNAL_STORYBOOK_SCHEMA_VERSION
  canonicalId: string
  id: string
  label: string
  source: StorybookSourceReference
  scopeRoot: string
  readmePath: string | null
  digest: string
}>

export type StorybookWorkspace = StorybookCatalogScopeBase & Readonly<{
  kind: "workspace"
  projectIds: readonly string[]
}>

export type StorybookProject = StorybookCatalogScopeBase & Readonly<{
  kind: "project"
  packageIds: readonly string[]
}>

export type StorybookPackage = StorybookCatalogScopeBase & Readonly<{
  kind: "package"
  packageJsonPath: string
  packageName: string
  authorStyleSheets: readonly StorybookAuthorStyleSheet[]
  widgetContributions: StorybookWidgetContributions | null
  runtime: StorybookModuleReference | null
  catalog: StorybookPackageCatalog | null
}>

export type StorybookCatalogScope =
  | StorybookWorkspace
  | StorybookProject
  | StorybookPackage

export type StorybookCatalog = Readonly<{
  schemaVersion: typeof EXTERNAL_STORYBOOK_SCHEMA_VERSION
  rootIds: readonly string[]
  scopes: readonly StorybookCatalogScope[]
}>

/**
Читает все выбранные корни в один кандидат каталога без изменения реестра.

Источник обязан проверить существование, владение и неоднозначность файлов.
Для обновления передаётся предыдущий каталог: локальная ошибка возвращается
у соответствующего scope с последним проверенным содержимым или пустой
оболочкой владельца. Соседние scopes обновляются независимо. Без предыдущего
каталога действует строгая проверка нового подключения.
Новый способ обнаружения подключается здесь без второго реестра или Workbench.
*/
export type StorybookCatalogResolver = (
  roots: readonly string[],
  previous?: StorybookCatalog,
) => Promise<StorybookCatalog>
