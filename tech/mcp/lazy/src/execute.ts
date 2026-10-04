import {ProtocolError, INTERNAL_ERROR, METHOD_NOT_FOUND, INVALID_PARAMS} from "@modelcontextprotocol/client"
import runBuildWorker from "@zavx0z/storybook-tech-build-worker"
import {realpathSync} from "node:fs"
import {resolve} from "node:path"
import {fileURLToPath} from "node:url"
import {
  MCP_HARD_KILL_DELAY_MS,
  MCP_RESULT_MAX_BYTES,
  isLazyMethod,
  isLazyOutcome,
  isRecord,
  parseLazyEvent,
  requestParams,
  type LazyJob,
  type LazyMethod,
  type LazyProgress,
} from "./protocol"

export type ExecuteLazyRequestInput = Readonly<{
  serverModule: string
  cwd: string
  temporaryRoot: string
  method: LazyMethod
  params?: Readonly<Record<string, unknown>> | undefined
  signal: AbortSignal
  onProgress?: ((progress: LazyProgress) => void | Promise<void>) | undefined
}>

/**
Делегирует один native MCP-запрос текущей default factory в свежем Bun-процессе.
Factory выбирается доверенной конфигурацией transport, а не аргументами инструмента.
Сохранённые isError, content, annotations и resource blobs принадлежат native SDK.
Progress доставляется последовательно; возврат ждёт callback последнего события.

Процесс выполняет signal cleanup с grace 10 секунд. SDK close не является
универсальным awaitIdle: factory.close обязана освобождать принадлежащую ей работу.
Для generic factory worker сохраняет bounded cancellation drain перед выходом.

@throws Native ProtocolError с исходными code/message/data либо нейтральная ошибка исполнителя.
*/
export async function executeLazyRequest(input: ExecuteLazyRequestInput): Promise<Record<string, unknown>> {
  if (!isLazyMethod(input.method)) throw new ProtocolError(METHOD_NOT_FOUND, "MCP method is not supported by lazy execution")
  if (input.params !== undefined && !isRecord(input.params)) throw new ProtocolError(INVALID_PARAMS, "MCP params must be an object")
  const progressCancellation = new AbortController()
  const signal = AbortSignal.any([input.signal, progressCancellation.signal])
  let progressQueue = Promise.resolve()
  let progressFailure: unknown = null
  let output: Awaited<ReturnType<typeof runBuildWorker>> | undefined
  let executionFailure: unknown = null
  try {
    const cwd = realpathSync(input.cwd)
    const modulePath = input.serverModule.startsWith("file:") ? fileURLToPath(input.serverModule) : resolve(cwd, input.serverModule)
    const serverModule = realpathSync(modulePath)
    output = await runBuildWorker<LazyJob, LazyProgress>({
      entryPath: fileURLToPath(new URL("./worker.ts", import.meta.url)),
      cwd,
      temporaryRoot: input.temporaryRoot,
      signal,
      hardKillDelayMs: MCP_HARD_KILL_DELAY_MS,
      maxResultBytes: MCP_RESULT_MAX_BYTES,
      label: "MCP lazy request",
      streamMode: "strict",
      createJob: () => ({serverModule, method: input.method, params: requestParams(input.params ?? {}), progress: input.onProgress !== undefined}),
      parseEvent: parseLazyEvent,
      onProgress(event) {
        progressQueue = progressQueue.then(async () => {
          if (signal.aborted) return
          await input.onProgress?.(event)
        }).catch(error => {
          progressFailure ??= error
          progressCancellation.abort(new Error("MCP progress delivery failed"))
        })
      },
    })
  } catch (error) {
    executionFailure = error
  }
  await progressQueue
  if (input.signal.aborted) {
    const timeout = input.signal.reason instanceof Error && input.signal.reason.name === "TimeoutError"
    throw new DOMException(timeout ? "MCP request timed out" : "MCP request was cancelled", timeout ? "TimeoutError" : "AbortError")
  }
  if (progressFailure !== null) {
    console.error("MCP lazy progress failed", progressFailure)
    throw new ProtocolError(INTERNAL_ERROR, "MCP progress delivery failed")
  }
  if (executionFailure !== null || output === undefined || !output.ready || output.exitCode !== 0 || !isLazyOutcome(output.result)) {
    console.error("MCP lazy execution failed", executionFailure ?? output?.stderr ?? "Invalid worker outcome")
    throw new ProtocolError(INTERNAL_ERROR, "MCP request execution failed")
  }
  if (!output.result.ok) {
    const {code, message, data} = output.result.error
    throw new ProtocolError(code, message, data)
  }
  return output.result.result
}
