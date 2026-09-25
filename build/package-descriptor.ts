import {readWorkbenchStyleSheets} from "./workbench-theme.ts"
import {createHash} from "node:crypto"
import {dirname, join, relative} from "node:path"
import type {StorybookCatalog, StorybookPackage} from "../catalog/catalog.t.ts"
import {externalStorybookNode, type ExternalStorybookGraph} from "../catalog/graph.ts"
import {createExternalStorybookResourceAllowList} from "../catalog/resource-allowlist.ts"
import type {StorybookPackageBuildDescriptor} from "../sessions/package-session.ts"
import {
  createStorybookPackageRevisionGraphSnapshot,
  revisionModuleDocumentationPath,
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
  const workbenchAuthorStyleSheets = readWorkbenchStyleSheets()
  return Object.freeze(packages.filter(declaration => include === undefined || include.has(declaration.id)).map((declaration) => {
    const node = externalStorybookNode(graph, declaration.canonicalId)
    const projectNode = [...node.structuralPath]
      .map((id) => externalStorybookNode(graph, id))
      .find(({kind}) => kind === "package")
    const projectDeclaration = projectNode === undefined
      ? null
      : catalog.scopes.find(({canonicalId}) => canonicalId === projectNode.id)
    const projectRoot = projectDeclaration !== undefined && projectDeclaration !== null
      ? projectDeclaration.scopeRoot
      : declaration.scopeRoot
    const scenarioSpecs = graph.nodes.flatMap((candidate) =>
      candidate.packageId === declaration.id && candidate.scenarioSpec !== undefined
        ? [{nodeId: candidate.id, sourcePaths: Object.freeze([...candidate.scenarioSpec.sourcePaths])}]
        : [])
    const documentationAssetsByNode = new Map(graph.nodes.flatMap((candidate) => {
      const documentation = candidate.moduleDocumentation
      if (candidate.packageId !== declaration.id || documentation === undefined) return []
      const assets = createExternalStorybookResourceAllowList({
        ownerRoot: declaration.scopeRoot,
        sourcePath: documentation.sourcePath,
        markdown: documentation.markdown,
      }).entries.filter(({kind}) => kind === "documentation-asset").map(({path}) => path)
      return [[candidate.id, Object.freeze(assets)] as const]
    }))
    const watchedPaths = [
      declaration.source.path,
      ...workbenchAuthorStyleSheets.map(({path}) => path),
      ...workbenchAuthorStyleSheets.map(({ownerPackageJsonPath}) => ownerPackageJsonPath),
      ...graph.nodes.flatMap((candidate) =>
        candidate.packageId === declaration.id
          ? [
            ...(candidate.moduleDocumentation ? [candidate.moduleDocumentation.sourcePath] : []),
            ...(candidate.dependencySpec ? [candidate.dependencySpec.sourcePath] : []),
            ...(candidate.scenarioSpec?.sourcePaths ?? []),
            ...(candidate.contractDocumentation?.sources.map(source => source.sourcePath) ?? []),
            ...(documentationAssetsByNode.get(candidate.id) ?? []),
          ]
          : []),
    ]
    const watchPaths = [
      {path: declaration.source.path, category: "declaration" as const},
      {path: declaration.packageJsonPath, category: "metadata" as const},
      {path: declaration.packageJsonPath, category: "code" as const},
      ...workbenchAuthorStyleSheets.map(({ownerPackageJsonPath}) => ({
        path: ownerPackageJsonPath,
        category: "declaration" as const,
      })),
      ...workbenchAuthorStyleSheets.map(({path}) => ({path, category: "resource" as const})),
      ...graph.nodes.flatMap((candidate) => candidate.packageId === declaration.id
        ? [
          ...(candidate.moduleDocumentation ? [{path: candidate.moduleDocumentation.sourcePath, category: "declaration" as const}] : []),
          ...(candidate.dependencySpec ? [{path: candidate.dependencySpec.sourcePath, category: "declaration" as const}] : []),
          ...(candidate.scenarioSpec?.sourcePaths.map(path => ({path, category: "declaration" as const})) ?? []),
          ...(candidate.contractDocumentation?.sources.map(source => ({path: source.sourcePath, category: "declaration" as const})) ?? []),
          ...(documentationAssetsByNode.get(candidate.id) ?? [])
            .map((path) => ({path, category: "resource" as const})),
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
      ...graph.nodes.flatMap((candidate) => {
        if (candidate.packageId !== declaration.id) return []
        return [
          ...(candidate.contractDocumentation?.sources.map((source, index) => ({
            sourcePath: source.sourcePath,
            sourceRoot: dirname(source.sourcePath),
            contentDigest: source.sourceDigest,
            derivedContent: JSON.stringify(candidate.contractDocumentation!.documents),
            targetPath: `${revisionModuleDocumentationPath(candidate.id)}.contract-${index}.json`,
          })) ?? []),
          ...(candidate.moduleDocumentation ? [{
            sourcePath: candidate.moduleDocumentation.sourcePath,
            sourceRoot: declaration.scopeRoot,
            contentDigest: candidate.moduleDocumentation.sourceDigest,
            derivedContent: candidate.moduleDocumentation.markdown,
            targetPath: revisionModuleDocumentationPath(candidate.id),
          }] : []),
          ...(!candidate.moduleDocumentation ? [] : (documentationAssetsByNode.get(candidate.id) ?? []).map((sourcePath) => ({
            sourcePath,
            targetPath: join(
              dirname(revisionModuleDocumentationPath(candidate.id)),
              relative(dirname(candidate.moduleDocumentation!.sourcePath), sourcePath),
            ),
          }))),

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
        workbenchAuthorStyleSheets,
      ),
      scenarioSpecs: Object.freeze(scenarioSpecs),
      watchedPaths: Object.freeze([...new Set(watchedPaths)]),
    })
  }))
}

function packageDeclarationDigest(
  declaration: StorybookPackage,
  graph: ExternalStorybookGraph,
  include?: ReadonlySet<string>,
): string {
  const hash = createHash("sha256").update(`${declaration.digest}\0`)
  for (const node of graph.nodes) {
    if (node.packageId === declaration.id) hash.update(`${node.id}\0${node.digest}\0`)
  }
  return hash.digest("hex")
}
