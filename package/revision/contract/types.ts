import type {Zavx0zStorybookRepoDiscovery} from "@zavx0z/storybook-repo-discovery"
type Package = Extract<Zavx0zStorybookRepoDiscovery.Output["scopes"][number], {kind: "package"}>
export type StorybookPackageRevisionAncestor = Readonly<{
  id: string
  parentId: string | null
  kind: "package" | "directory" | "entry" | "unavailable"
  label: string
  urlPath: string
}>

export type StorybookPackageRevisionGraphNode = Readonly<{
  id: string
  kind: "package" | "directory" | "entry"
  ownerId: string
  packageId: string
  label: string
  parentId: string | null
  childIds: readonly string[]
  urlPath: string
  routePath: string
  searchTerms: readonly string[]
  entryConditions?: readonly (readonly string[])[]
  hasModuleDocumentation?: boolean
  dependencyCases?: readonly NonNullable<Package["dependencySpec"]>["cases"][number][]
  dependencyRoutePath?: string
  contractRoutePath?: string
  scenariosRoutePath?: string
  contractDocuments?: readonly Omit<NonNullable<Package["contractDocumentation"]>["documents"][number], "sourcePath">[]
  resourceUrl: string
}>

export type StorybookPackageRevisionRoute = Readonly<{
  path: string
  urlPath: string
  kind: "overview" | "dependencies" | "contract" | "scenarios"
  nodeId: string
}>

export type StorybookPackageRevisionResourceLink = Readonly<{
  nodeId: string
  kind: "module-documentation"
  index: number
  url: string
}>

export type StorybookPackageRevisionAuthorStyleSheet = Readonly<{
  specifier: string
  url: string
  contentDigest: string
}>
/** Точный исходный CSS владельца до копирования в неизменяемую ревизию. */
export type StorybookAuthorStyleSheetSource = Readonly<{
  specifier: string
  path: string
  ownerRoot: string
  ownerPackageJsonPath: string
  contentDigest: string
}>

/** Неизменяемая проекция одного пакета из публичного графа. */
export type StorybookPackageRevisionGraphSnapshot = Readonly<{
  protocol: "storybook-package-graph/6"
  packageId: string
  declarationDigest: string
  packageGraphDigest: string
  metadata: Readonly<{
    parentId: string | null
    label: string
    ownerId: string
    urlPath: string
  }>
  ancestors: readonly StorybookPackageRevisionAncestor[]
  rootId: string
  nodes: readonly StorybookPackageRevisionGraphNode[]
  routes: readonly StorybookPackageRevisionRoute[]
  resources: readonly StorybookPackageRevisionResourceLink[]
  workbenchAuthorStyleSheets: readonly StorybookPackageRevisionAuthorStyleSheet[]
}>
