import {parentPort, workerData} from "node:worker_threads"
import discover from "@zavx0z/storybook-package-metadata-collect"
import {prepareCatalogSnapshot} from "./prepare"
import {emptyCatalog} from "./helpers"
import type {CatalogWorkerInput, CatalogWorkerMessage} from "./worker-protocol"
import {saveCatalogMetadata, renameMetadataProject} from "./metadata"
import {readLegacyMetadata, readMetadataSnapshot, readMetadataTree} from "./storage"
import createGraph from "@zavx0z/storybook-package-graph-create"
import {MetadataRootNotTrusted} from "./roots"

if (parentPort === null) throw new Error("Catalog worker requires a parent")
const port = parentPort
const send = (message: CatalogWorkerMessage) => port.postMessage(message)
try {
  const input = workerData as CatalogWorkerInput
  if (input.kind === "rename-files") {
    send({type: "result", result: {kind: "metadata-saved", result: await renameMetadataProject(input.project)}})
  } else if (input.kind === "open-files" || input.kind === "refresh-files") {
    const empty = {revision: 0, entries: [], catalog: emptyCatalog(), graph: createGraph(emptyCatalog()), descriptors: []}
    let previous = empty as Parameters<typeof prepareCatalogSnapshot>[2]
    let legacy: ReturnType<typeof readLegacyMetadata> | undefined
    let reusable = false
    let previousDigest = previous.graph.digest
    try {
      const tree = readMetadataTree(input.project.root)
      // Число версии и digest индекса не требуют доступа к прежним владельцам.
      if (Number.isSafeInteger(tree.revision) && tree.revision >= 0) previous = {...empty, revision: tree.revision}
      if (typeof tree.graphDigest === "string") previousDigest = tree.graphDigest
      if (tree.schemaVersion === 2) {
        previous = readMetadataSnapshot(input.project.root, () => input.styles, input.trustedRoots)
        reusable = true
      }
      else legacy = readLegacyMetadata(input.project.root, input.trustedRoots)
    } catch (error) {
      if (!(error instanceof MetadataRootNotTrusted) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      // Отозванные корни не становятся previous: discover не читает их ленивые документы.
    }
    const existingRoots = legacy === undefined
      ? previous.entries.map(entry => entry.declarationPath)
      : legacy.rootIds.map(id => legacy!.scopes.find(scope => scope.canonicalId === id)!.scopeRoot)
    const sameRoots = JSON.stringify(existingRoots) === JSON.stringify(input.roots)
    let discovered = false
    if (input.kind === "open-files" && sameRoots && legacy === undefined && reusable && previous.revision > 0) {
      await renameMetadataProject(input.project)
    } else {
      const catalog = input.kind === "open-files" && sameRoots && legacy !== undefined ? legacy
        : input.roots.length === 0 ? emptyCatalog() : await discover(input.roots, previous.catalog, {
          ...(input.dirtyScopeRoots === undefined ? {} : {dirtyScopeRoots: input.dirtyScopeRoots}),
          onAnalysisSession: kind => send({type: "analysis", kind}),
        })
      discovered = catalog !== legacy && input.roots.length > 0
      const prepared = prepareCatalogSnapshot(catalog, input.sources, previous, input.styles)
      if (prepared.snapshot !== null) await saveCatalogMetadata(input.project, prepared.snapshot, input.trustedRoots)
      else if (!reusable || previous.revision === 0) await saveCatalogMetadata(input.project, {...previous, revision: previous.revision + 1}, input.trustedRoots)
    }
    const current = readMetadataSnapshot(input.project.root, () => input.styles, input.trustedRoots)
    send({type: "result", result: {kind: "files-ready", discovered, graphChanged: current.graph.digest !== previousDigest}})
  } else if (input.kind === "save-metadata") {
    send({type: "result", result: {kind: "metadata-saved", result: await saveCatalogMetadata(input.project, input.snapshot, input.trustedRoots)}})
  } else {
    const previous = input.kind === "prepare" ? input.previous.catalog : input.previous
    const catalog = input.kind === "prepare" && input.catalog !== undefined ? input.catalog
      : input.roots.length === 0 ? emptyCatalog() : await discover(input.roots, previous, {
      ...(input.dirtyScopeRoots === undefined ? {} : {dirtyScopeRoots: input.dirtyScopeRoots}),
      onAnalysisSession: kind => send({type: "analysis", kind}),
    })
    send({type: "result", result: input.kind === "prepare"
      ? {kind: "prepared", result: prepareCatalogSnapshot(catalog, input.sources, input.previous, input.styles)}
      : {kind: "discovered", catalog}})
  }
} catch (error) {
  send({type: "failure", message: error instanceof Error ? error.message : String(error)})
} finally { port.close() }
