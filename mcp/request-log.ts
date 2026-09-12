import {randomUUID} from "node:crypto"
import {ExternalStorybookControlClient} from "../server/control-client.ts"
import {externalStorybookServerStatePath, readExternalStorybookServerRecord} from "../server/server-state.ts"
import {sanitizeMcpValue, sanitizeMcpString} from "./public-boundary.ts"

/** Передаёт запись в журнал действующего HTTP-сервера; сбой журнала не отменяет основную операцию. */
export async function recordMcpRequest(entry: Record<string, unknown>): Promise<void> {
  try {
    const record = readExternalStorybookServerRecord(externalStorybookServerStatePath())
    await new ExternalStorybookControlClient(record).control("/api/control/mcp-requests", entry, AbortSignal.timeout(1000))
  } catch {
    // Сервер может ещё запускаться или использовать прежнюю версию без журнала.
  }
}

/** Записывает начало и завершение обращения без изменения его результата. */
export async function traceMcpRequest<T>(
  tool: string,
  input: unknown,
  operation: () => Promise<T>,
  record: typeof recordMcpRequest,
): Promise<T> {
  const startedAt = Date.now()
  const entry = {id: randomUUID(), tool, startedAt, input: JSON.stringify(sanitizeMcpValue(input), null, 2) ?? ""}
  await record({...entry, status: "running", durationMs: null, result: ""})
  try {
    const result = await operation()
    const capture = tool === "storybook_capture" && result && typeof result === "object"
      ? result as {captureId?: unknown, image?: unknown} : undefined
    const captureId = typeof capture?.captureId === "string" ? capture.captureId : undefined
    const report = captureId === undefined ? result : Object.fromEntries(Object.entries(result as object).filter(([key]) => key !== "image"))
    const status = result && typeof result === "object" ? (result as {status?: unknown}).status : undefined
    await record({...entry, durationMs: Date.now() - startedAt, status: ["failed", "timeout", "unavailable"].includes(String(status)) ? "failed" : "success", ...(captureId === undefined ? {} : {captureId}), result: JSON.stringify(sanitizeMcpValue(report), null, 2) ?? "null"})
    return result
  } catch (error) {
    await record({...entry, durationMs: Date.now() - startedAt, status: "failed", result: JSON.stringify({error: sanitizeMcpString(error instanceof Error ? error.message : String(error))}, null, 2)})
    throw error
  }
}
