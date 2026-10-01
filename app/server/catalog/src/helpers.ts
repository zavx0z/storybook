import {type RepoDiscovery as RepoDiscoveryContract} from "@repo/discovery"
import PackageGraphCreateOwner, {type PackageGraphCreate as PackageGraphCreateContract} from "@package-graph/create"
import PackageGraphReadOwner from "@package-graph/read"
import {type PackageSession as PackageSessionContract} from "@package/session"
import PackageBuildDescriptorOwner from "@package-build/descriptor"
const EXTERNAL_STORYBOOK_SCHEMA_VERSION = 1
const createExternalStorybookGraph = PackageGraphCreateOwner
const externalStorybookNode = PackageGraphReadOwner.node
const externalStorybookPackageDescriptors = PackageBuildDescriptorOwner
type StorybookCatalog = RepoDiscoveryContract.Output
type StorybookCatalogScope = RepoDiscoveryContract.Output["scopes"][number]
type ExternalStorybookGraph = PackageGraphCreateContract.Output
type StorybookPackageBuildDescriptor = PackageSessionContract.Input[0]
import {resolve} from "node:path"

import type {
  ExternalStorybookAttachSource,
  ExternalStorybookRegistryEntry,
  ExternalStorybookRegistrySnapshot,
  ExternalStorybookRegistryDirtySnapshot,
  ExternalStorybookRegistryMetrics,
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
