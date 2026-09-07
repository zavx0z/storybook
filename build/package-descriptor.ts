import {createHash} from "node:crypto"
import {dirname, join, relative} from "node:path"
import type {StorybookCatalog, StorybookPackage} from "../catalog/catalog.t.ts"
import {externalStorybookNode, type ExternalStorybookGraph} from "../catalog/graph.ts"
import {mergeStorybookAuthorStyleSheets} from "../catalog/author-style-sheets.ts"
import {createExternalStorybookResourceAllowList} from "../catalog/resource-allowlist.ts"
import type {StorybookPackageBuildDescriptor} from "../sessions/package-session.ts"
import {
  createStorybookPackageRevisionGraphSnapshot,
  revisionAuthorStyleSheetPath,
  revisionDeclaredResourcePath,
  revisionReadmeResourcePath,
  revisionWorkbenchAuthorStyleSheetPath,
} from "../sessions/package-revision.ts"

/** Derives build inputs from the canonical graph instead of a second build registry. */
export function externalStorybookPackageDescriptors(
  catalog: StorybookCatalog,
  graph: ExternalStorybookGraph,
  include?: ReadonlySet<string>,
): readonly StorybookPackageBuildDescriptor[] {
  const packages = catalog.scopes.filter(
    (declaration): declaration is StorybookPackage => declaration.kind === "package",
  )
  const workbenchDeclaration = packages.find(({id}) => id === "@zavx0z/storybook") ?? null
  const workbenchAuthorStyleSheets = workbenchDeclaration?.authorStyleSheets ?? Object.freeze([])
  return Object.freeze(packages.filter(declaration => include === undefined || include.has(declaration.id)).map((declaration) => {
    mergeStorybookAuthorStyleSheets(workbenchAuthorStyleSheets, declaration.authorStyleSheets)
    const node = externalStorybookNode(graph, declaration.canonicalId)
    const projectNode = [...node.structuralPath].reverse()
      .map((id) => externalStorybookNode(graph, id))
      .find(({kind}) => kind === "project")
    const projectDeclaration = projectNode === undefined
      ? null
      : catalog.scopes.find(({canonicalId}) => canonicalId === projectNode.id)
    const projectRoot = projectDeclaration?.kind === "project"
      ? projectDeclaration.scopeRoot
      : declaration.scopeRoot
    const variants = graph.nodes.flatMap((candidate) =>
      candidate.kind === "variant" && candidate.packageId === declaration.id && candidate.module !== null
        ? [{
          route: candidate.routePath!,
          module: {path: candidate.module.path, export: candidate.module.exportName},
        }]
        : [])
    const widgetModules = declaration.widgetContributions?.items.flatMap((item) => item.kind === "component"
      ? [{id: item.id, module: {path: item.module.path, export: item.module.exportName}}]
      : []) ?? []
    if (variants.length > 0 && declaration.runtime === null) {
      throw new Error(`Executable package has no Storybook runtime: ${declaration.id}`)
    }
    const readmeAssetsByNode = new Map(graph.nodes.flatMap((candidate) => {
      if (candidate.packageId !== declaration.id || candidate.readmePath === null) return []
      const assets = createExternalStorybookResourceAllowList({
        ownerRoot: declaration.scopeRoot,
        readmePath: candidate.readmePath,
        declaredResources: candidate.resources,
      }).entries.filter(({kind}) => kind === "readme-asset").map(({path}) => path)
      return [[candidate.id, Object.freeze(assets)] as const]
    }))
    const watchedPaths = [
      declaration.source.path,
      ...(declaration.catalog?.sourcePaths ?? []),
      ...(declaration.readmePath === null ? [] : [declaration.readmePath]),
      ...(declaration.runtime === null ? [] : [declaration.runtime.path]),
      ...variants.map(({module}) => module.path),
      ...widgetModules.map(({module}) => module.path),
      ...declaration.authorStyleSheets.map(({path}) => path),
      ...declaration.authorStyleSheets.map(({ownerPackageJsonPath}) => ownerPackageJsonPath),
      ...workbenchAuthorStyleSheets.map(({path}) => path),
      ...workbenchAuthorStyleSheets.map(({ownerPackageJsonPath}) => ownerPackageJsonPath),
      ...graph.nodes.flatMap((candidate) =>
        candidate.packageId === declaration.id
          ? [
            ...(candidate.readmePath === null ? [] : [candidate.readmePath]),
            ...(readmeAssetsByNode.get(candidate.id) ?? []),
            ...candidate.resources.map(({path}) => path),
          ]
          : []),
    ]
    const watchPaths = [
      {path: declaration.source.path, category: "declaration" as const},
      ...(declaration.catalog?.sourcePaths ?? []).map((path) => ({path, category: "declaration" as const})),
      {path: declaration.packageJsonPath, category: "metadata" as const},
      {path: declaration.packageJsonPath, category: "code" as const},
      ...(declaration.runtime === null
        ? []
        : [{path: declaration.runtime.path, category: "code" as const}]),
      ...variants.map(({module}) => ({path: module.path, category: "code" as const})),
      ...widgetModules.map(({module}) => ({path: module.path, category: "code" as const})),
      ...declaration.authorStyleSheets.map(({ownerPackageJsonPath}) => ({
        path: ownerPackageJsonPath,
        category: "declaration" as const,
      })),
      ...declaration.authorStyleSheets.map(({path}) => ({path, category: "resource" as const})),
      ...workbenchAuthorStyleSheets.map(({ownerPackageJsonPath}) => ({
        path: ownerPackageJsonPath,
        category: "declaration" as const,
      })),
      ...workbenchAuthorStyleSheets.map(({path}) => ({path, category: "resource" as const})),
      ...(declaration.readmePath === null
        ? []
        : [{path: declaration.readmePath, category: "metadata" as const}]),
      ...graph.nodes.flatMap((candidate) => candidate.packageId === declaration.id
        ? [
          ...(candidate.readmePath === null
            ? []
            : [{path: candidate.readmePath, category: "metadata" as const}]),
          ...(readmeAssetsByNode.get(candidate.id) ?? [])
            .map((path) => ({path, category: "resource" as const})),
          ...candidate.resources.map(({path}) => ({path, category: "resource" as const})),
        ]
        : []),
    ]
    const declarationDigest = packageDeclarationDigest(declaration, graph)
    const resourceFiles = [
      ...workbenchAuthorStyleSheets.map((styleSheet, index) => ({
        sourcePath: styleSheet.path,
        sourceRoot: styleSheet.ownerRoot,
        targetPath: revisionWorkbenchAuthorStyleSheetPath(index),
        contentDigest: styleSheet.contentDigest,
      })),
      ...declaration.authorStyleSheets.map((styleSheet, index) => ({
        sourcePath: styleSheet.path,
        sourceRoot: styleSheet.ownerRoot,
        targetPath: revisionAuthorStyleSheetPath(index),
        contentDigest: styleSheet.contentDigest,
      })),
      ...graph.nodes.flatMap((candidate) => {
        if (candidate.packageId !== declaration.id) return []
        const indexes = new Map<string, number>()
        return [
          ...(candidate.readmePath === null
            ? []
            : [{sourcePath: candidate.readmePath, targetPath: revisionReadmeResourcePath(candidate.id)}]),
          ...(candidate.readmePath === null ? [] : (readmeAssetsByNode.get(candidate.id) ?? []).map((sourcePath) => ({
            sourcePath,
            targetPath: join(
              dirname(revisionReadmeResourcePath(candidate.id)),
              relative(dirname(candidate.readmePath!), sourcePath),
            ),
          }))),
          ...candidate.resources.map((resource) => {
            const index = indexes.get(resource.kind) ?? 0
            indexes.set(resource.kind, index + 1)
            return {
              sourcePath: resource.path,
              targetPath: revisionDeclaredResourcePath(candidate.id, resource.kind, index, resource.path),
            }
          }),
        ]
      }),
    ]
    return Object.freeze({
      packageId: declaration.id,
      packageRoot: declaration.scopeRoot,
      projectRoot,
      sourcePath: declaration.source.path,
      declarationDigest,
      resourceFiles: Object.freeze(resourceFiles),
      watchPaths: Object.freeze(watchPaths),
      graphSnapshot: createStorybookPackageRevisionGraphSnapshot(
        graph,
        declaration.id,
        declarationDigest,
      ),
      runtime: declaration.runtime === null
        ? null
        : {path: declaration.runtime.path, export: declaration.runtime.exportName},
      variants: Object.freeze(variants),
      widgetModules: Object.freeze(widgetModules),
      watchedPaths: Object.freeze([...new Set(watchedPaths)]),
    })
  }))
}

function packageDeclarationDigest(
  declaration: StorybookPackage,
  graph: ExternalStorybookGraph,
  include?: ReadonlySet<string>,
): string {
  const hash = createHash("sha256").update(`${declaration.digest}\0${declaration.catalog?.digest ?? ""}\0`)
  for (const node of graph.nodes) {
    if (node.packageId === declaration.id) hash.update(`${node.id}\0${node.digest}\0`)
  }
  return hash.digest("hex")
}
