/**
Выводит входы сборки пакетов из проверенного каталога и его графа.
Документация, сценарии и переданные приложением стили остаются связаны со своими исходниками.

@packageDocumentation
*/
import {type RepoDiscovery as RepoDiscoveryContract} from "@repo/discovery"
import PackageGraphReadOwner from "@package-graph/read"
import {type PackageGraphCreate as PackageGraphCreateContract} from "@package-graph/create"
import PackageResourcesOwner from "@package/resources"
import {type PackageSession as PackageSessionContract} from "@package/session"
import PackageRevisionOwner from "@package/revision"
const externalStorybookNode = PackageGraphReadOwner.node
const createExternalStorybookResourceAllowList = PackageResourcesOwner
const createStorybookPackageRevisionGraphSnapshot = PackageRevisionOwner.create
const revisionModuleDocumentationPath = PackageRevisionOwner.moduleDocumentationPath
const revisionWorkbenchAuthorStyleSheetPath = PackageRevisionOwner.workbenchAuthorStyleSheetPath
type StorybookCatalog = RepoDiscoveryContract.Output
type StorybookPackage = Extract<RepoDiscoveryContract.Output["scopes"][number], {kind: "package"}>
type ExternalStorybookGraph = PackageGraphCreateContract.Output
type StorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
import {createHash} from "node:crypto"
import {dirname, join, relative} from "node:path"
import type {PackageBuildDescriptor} from "./contract"

export type {PackageBuildDescriptor} from "./contract"

/**
Выводит входы сборки из canonical graph. Первый пакет структурного пути задаёт
содержащий Repo; конкретный Project не входит в compiler context пакета.
*/
export default function externalStorybookPackageDescriptors(
  catalog: PackageBuildDescriptor.Input[0],
  graph: PackageBuildDescriptor.Input[1],
  include?: PackageBuildDescriptor.Input[2],
  styles: NonNullable<PackageBuildDescriptor.Input[3]> = [],
): PackageBuildDescriptor.Output {
  const packages = catalog.scopes.filter(
    (declaration): declaration is StorybookPackage => declaration.kind === "package",
  )
  const workbenchAuthorStyleSheets = styles
  return Object.freeze(packages.filter(declaration => include === undefined || include.has(declaration.id)).map((declaration) => {
    const node = externalStorybookNode(graph, declaration.canonicalId)
    const repoNode = [...node.structuralPath]
      .map((id) => externalStorybookNode(graph, id))
      .find(({kind}) => kind === "package")
    const repoDeclaration = repoNode === undefined
      ? null
      : catalog.scopes.find(({canonicalId}) => canonicalId === repoNode.id)
    const repo = repoDeclaration !== undefined && repoDeclaration !== null
      ? repoDeclaration.scopeRoot
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
      repo,
      sourcePath: declaration.source.path,
      declarationDigest,
      resourceFiles: Object.freeze(resourceFiles),
      graphSnapshot: createStorybookPackageRevisionGraphSnapshot(
        graph,
        declaration.id,
        declarationDigest,
        workbenchAuthorStyleSheets,
      ),
      scenarioSpecs: Object.freeze(scenarioSpecs),
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
