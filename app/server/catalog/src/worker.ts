import {parentPort, workerData} from "node:worker_threads"
import discover from "@storybook-repo/discovery"
import {prepareCatalogSnapshot} from "./prepare"
import {emptyCatalog} from "./helpers"
import type {CatalogWorkerInput, CatalogWorkerMessage} from "./worker-protocol"

if (parentPort === null) throw new Error("Catalog worker requires a parent")
const port = parentPort
const send = (message: CatalogWorkerMessage) => port.postMessage(message)
try {
  const input = workerData as CatalogWorkerInput
  const previous = input.kind === "prepare" ? input.previous.catalog : input.previous
  const catalog = input.kind === "prepare" && input.catalog !== undefined ? input.catalog
    : input.roots.length === 0 ? emptyCatalog() : await discover(input.roots, previous, {
    ...(input.dirtyScopeRoots === undefined ? {} : {dirtyScopeRoots: input.dirtyScopeRoots}),
    onAnalysisSession: kind => send({type: "analysis", kind}),
  })
  send({type: "result", result: input.kind === "prepare"
    ? {kind: "prepared", result: prepareCatalogSnapshot(catalog, input.sources, input.previous, input.styles)}
    : {kind: "discovered", catalog}})
} catch (error) {
  send({type: "failure", message: error instanceof Error ? error.message : String(error)})
} finally { port.close() }
