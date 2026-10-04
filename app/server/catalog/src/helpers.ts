import {type Zavx0zStorybookRepoDiscovery as RepoDiscoveryContract} from "@zavx0z/storybook-repo-discovery"
import {type Zavx0zStorybookPackageGraphCreate as PackageGraphCreateContract} from "@zavx0z/storybook-package-graph-create"
import PackageGraphReadOwner from "@zavx0z/storybook-package-graph-read"
const EXTERNAL_STORYBOOK_SCHEMA_VERSION = 1
const externalStorybookNode = PackageGraphReadOwner.node
type StorybookCatalog = RepoDiscoveryContract.Output
type StorybookCatalogScope = RepoDiscoveryContract.Output["scopes"][number]
type ExternalStorybookGraph = PackageGraphCreateContract.Output
import {resolve} from "node:path"

import type {
  ExternalStorybookAttachSource,
  ExternalStorybookRegistryEntry,
} from "../contract/models"
export function createEntries(
  catalog: StorybookCatalog,
  graph: ExternalStorybookGraph,
  sources: readonly ExternalStorybookAttachSource[],
): readonly ExternalStorybookRegistryEntry[] {
  if (sources.length !== catalog.rootIds.length) {
    throw new Error("External Storybook attach-source count does not match roots")
  }
  return Object.freeze(catalog.rootIds.map((rootId, index) => {
    const root = catalog.scopes.find(({canonicalId}) => canonicalId === rootId)
    if (root === undefined) throw new Error(`External Storybook root is missing: ${rootId}`)
    const rootNode = externalStorybookNode(graph, rootId)
    const descendantIds = graph.nodes
      .filter(({structuralPath}) => structuralPath[0] === rootId)
      .map(({id}) => id)
    return Object.freeze({
      declarationPath: root.scopeRoot,
      rootKind: root.kind,
      canonicalId: rootId,
      digest: rootNode.digest,
      descendantIds: Object.freeze(descendantIds),
      attachSource: sources[index]!,
    })
  }))
}

export function scopePaths(scope: StorybookCatalogScope): ReadonlySet<string> {
  return new Set([
    resolve(scope.source.path),
    resolve(scope.scopeRoot),
    resolve(scope.scopeRoot, "package.json"),
    ...(scope.structurePaths ?? []).map(path => resolve(path)),
    ...(scope.kind === "package" ? [
      resolve(scope.packageJsonPath),
    ] : []),
  ])
}

export function emptyCatalog(): StorybookCatalog {
  return Object.freeze({
    schemaVersion: EXTERNAL_STORYBOOK_SCHEMA_VERSION,
    rootIds: Object.freeze([]),
    scopes: Object.freeze([]),
  })
}
