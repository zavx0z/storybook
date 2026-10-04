import createGraph from "@zavx0z/storybook-package-graph-create"
import createDescriptors from "@zavx0z/storybook-package-build-descriptor"
import {createEntries} from "./helpers"
import type {Zavx0zStorybookAppServerCatalog} from "../contract"
import type {ExternalStorybookAttachSource, ExternalStorybookRegistrySnapshot} from "../contract/models"
import type {Zavx0zStorybookPackageMetadataCollect} from "@zavx0z/storybook-package-metadata-collect"
import type {CatalogPreparation} from "./worker-protocol"

/** Граф и индексы готовятся до публикации дерева; сравнение не раскрывает тексты ресурсов. */
export function prepareCatalogSnapshot(
  catalog: Zavx0zStorybookPackageMetadataCollect.Output,
  sources: readonly ExternalStorybookAttachSource[],
  previous: ExternalStorybookRegistrySnapshot,
  styles: ReturnType<NonNullable<Zavx0zStorybookAppServerCatalog.Input[1]>>,
): CatalogPreparation {
  const graph = createGraph(catalog)
  const failed = new Set(catalog.scopes.filter(scope => scope.resolutionError !== undefined).map(scope => scope.id))
  const retained = previous.descriptors.filter(descriptor => failed.has(descriptor.packageId))
  const retainedIds = new Set(retained.map(descriptor => descriptor.packageId))
  const include = new Set(catalog.scopes.filter(scope => scope.kind === "package" && !retainedIds.has(scope.id)).map(scope => scope.id))
  const descriptors = Object.freeze([...createDescriptors(catalog, graph, include, styles), ...retained])
  const entries = createEntries(catalog, graph, sources)
  const before = new Map(previous.descriptors.map(descriptor => [descriptor.packageId, descriptor]))
  const unchangedPackageIds = descriptors.filter(descriptor => {
    const current = before.get(descriptor.packageId)
    return current !== undefined && current.declarationDigest === descriptor.declarationDigest &&
      current.graphSnapshot.packageGraphDigest === descriptor.graphSnapshot.packageGraphDigest &&
      current.packageRoot === descriptor.packageRoot && current.repo === descriptor.repo &&
      current.sourcePath === descriptor.sourcePath
  }).map(descriptor => descriptor.packageId)
  const graphUnchanged = graph.digest === previous.graph.digest
  const descriptorsUnchanged = descriptors.length === previous.descriptors.length && unchangedPackageIds.length === descriptors.length &&
    descriptors.every((descriptor, index) => descriptor.packageId === previous.descriptors[index]!.packageId)
  if (graphUnchanged && descriptorsUnchanged &&
    JSON.stringify(catalog.scopes.map(scope => [scope.resolutionError, scope.structurePaths])) ===
    JSON.stringify(previous.catalog.scopes.map(scope => [scope.resolutionError, scope.structurePaths]))) {
    return {snapshot: null, unchangedPackageIds}
  }
  return {snapshot: {revision: previous.revision + 1, entries, catalog, graph, descriptors}, unchangedPackageIds}
}
