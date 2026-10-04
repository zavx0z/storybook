import {Worker} from "node:worker_threads"
import type {CatalogWorkerInput, CatalogWorkerMessage, CatalogWorkerResult} from "./worker-protocol"

/** Native worker изолирует CPU-анализ от HTTP event loop; общего таймера работы нет. */
export async function runCatalogWorker(
  input: CatalogWorkerInput,
  signal: AbortSignal,
  onAnalysis: (kind: "contract" | "dependency") => void,
  entry = new URL("./worker.ts", import.meta.url),
): Promise<CatalogWorkerResult> {
  signal.throwIfAborted()
  const worker = new Worker(entry, {workerData: input})
  let abort = () => {}
  try {
    return await new Promise<CatalogWorkerResult>((resolve, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener("abort", abort, {once: true})
      worker.on("message", (message: CatalogWorkerMessage) => {
        if (signal.aborted) return
        if (message.type === "analysis") onAnalysis(message.kind)
        else if (message.type === "failure") reject(new Error(message.message))
        else if (message.type === "result") resolve(message.result)
        else reject(new Error("Invalid catalog worker message"))
      })
      worker.once("error", reject)
      worker.once("exit", code => reject(new Error(`Catalog worker exited without result: ${code}`)))
      if (signal.aborted) abort()
    })
  } finally {
    signal.removeEventListener("abort", abort)
    await worker.terminate()
  }
}
