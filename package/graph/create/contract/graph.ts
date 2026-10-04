import type {Zavx0zStorybookRepoDiscovery} from "@zavx0z/storybook-repo-discovery"

type Scope = Zavx0zStorybookRepoDiscovery.Output["scopes"][number]
type PackageScope = Extract<Scope, {kind: "package"}>

/** Вид физического источника навигации; не назначает архетип пакета. */
export type GraphNodeKind = "unavailable" | "package" | "directory" | "entry"

/** Проверенный узел графа с route identity и сведениями исходного владельца. */
export type GraphNode = Readonly<{
  id: string
  kind: GraphNodeKind
  ownerId: string
  packageId: string | null
  label: string
  structuralPath: readonly string[]
  urlPath: string
  routePath: string | null
  parentId: string | null
  childIds: readonly string[]
  entryConditions?: readonly (readonly string[])[]
  moduleDocumentation?: Scope["moduleDocumentation"]
  dependencySpec?: PackageScope["dependencySpec"]
  dependencyRoutePath?: string
  contractDocumentation?: PackageScope["contractDocumentation"]
  contractRoutePath?: string
  scenarioSpec?: PackageScope["scenarioSpec"]
  scenariosRoutePath?: string
  searchTerms: readonly string[]
  source: Scope["source"]
  packageJsonPath: string | null
  digest: string
}>
