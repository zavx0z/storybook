import {parentPort, workerData} from "node:worker_threads"
import discover from "@zavx0z/storybook-package-metadata-collect"
import {prepareCatalogSnapshot} from "./prepare"
import {emptyCatalog} from "./helpers"
import type {CatalogWorkerInput, CatalogWorkerMessage} from "./worker-protocol"
import {saveCatalogMetadata, renameMetadataProject} from "./metadata"
import {readLegacyMetadata, readMetadataSnapshot} from "./storage"
import createGraph from "@zavx0z/storybook-package-graph-create"
import {isAbsolute, join, relative, sep} from "node:path"

if (parentPort === null) throw new Error("Catalog worker requires a parent")
const port = parentPort
const send = (message: CatalogWorkerMessage) => port.postMessage(message)
try {
  const input = workerData as CatalogWorkerInput
  if (input.kind === "rename-files") {
    send({type: "result", result: {kind: "metadata-saved", result: await renameMetadataProject(input.project)}})
  } else if (input.kind === "open-files" || input.kind === "refresh-files") {
    const treeFile = Bun.file(join(input.project.root, "meta/data/tree.json"))
    const empty = {revision: 0, entries: [], catalog: emptyCatalog(), graph: createGraph(emptyCatalog()), descriptors: []}
    let previous = empty as Parameters<typeof prepareCatalogSnapshot>[2]
    let legacy: ReturnType<typeof readLegacyMetadata> | undefined
    if (await treeFile.exists()) {
      const tree = await treeFile.json()
      if (tree.schemaVersion === 2) {
        // meta/data — пересоздаваемый индекс. Старый физический корень после
        // переноса Project не должен мешать запуску из текущего каталога.
        const moved = Array.isArray(tree.entries) && tree.entries.some((entry: {declarationPath: string}) => {
          const local = relative(input.project.root, entry.declarationPath)
          return isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`)
        })
        if (!moved) previous = readMetadataSnapshot(input.project.root, () => input.styles)
      }
      else legacy = readLegacyMetadata(input.project.root)
    }
    const existingRoots = legacy === undefined
      ? previous.entries.map(entry => entry.declarationPath)
      : legacy.rootIds.map(id => legacy!.scopes.find(scope => scope.canonicalId === id)!.scopeRoot)
    const sameRoots = JSON.stringify(existingRoots) === JSON.stringify(input.roots)
    let discovered = false
    if (input.kind === "open-files" && sameRoots && legacy === undefined && previous.revision > 0) {
      await renameMetadataProject(input.project)
    } else {
      const catalog = input.kind === "open-files" && sameRoots && legacy !== undefined ? legacy
        : input.roots.length === 0 ? emptyCatalog() : await discover(input.roots, previous.catalog, {
          ...(input.dirtyScopeRoots === undefined ? {} : {dirtyScopeRoots: input.dirtyScopeRoots}),
          onAnalysisSession: kind => send({type: "analysis", kind}),
        })
      discovered = catalog !== legacy && input.roots.length > 0
      const prepared = prepareCatalogSnapshot(catalog, input.sources, previous, input.styles)
      if (prepared.snapshot !== null) await saveCatalogMetadata(input.project, prepared.snapshot)
      else if (previous.revision === 0) await saveCatalogMetadata(input.project, {...previous, revision: 1})
    }
    const current = readMetadataSnapshot(input.project.root, () => input.styles)
    send({type: "result", result: {kind: "files-ready", discovered, graphChanged: current.graph.digest !== previous.graph.digest}})
  } else if (input.kind === "save-metadata") {
    send({type: "result", result: {kind: "metadata-saved", result: await saveCatalogMetadata(input.project, input.snapshot)}})
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
