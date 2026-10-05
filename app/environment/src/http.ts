import ToolError from "@zavx0z/ai-tech-failure"
import type {Failure} from "../contract/events"

const maxBodyBytes = 16 * 1024 * 1024

export function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(key => !keys.includes(key))) {
    throw new ToolError("INVALID_INPUT", `Ожидается объект с полями ${keys.join(", ")}`)
  }
  return input as Record<string, unknown>
}

export function identity(input: unknown, field: string): string {
  if (typeof input !== "string" || input.trim() === "" || input !== input.trim() || /[\u0000-\u001f\u007f]/u.test(input)) {
    throw new ToolError("INVALID_INPUT", `Нужен непустой ${field} без крайних пробелов и управляющих символов`)
  }
  return input
}

/** Ограничивает фактически поступающие байты, включая тело без Content-Length. */
export async function readCommand(request: Request): Promise<{name: string, arguments: Record<string, unknown>}> {
  const length = request.headers.get("content-length")
  if (length !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(length) || Number(length) > maxBodyBytes)) {
    throw new ToolError("LIMIT_EXCEEDED", "Тело команды превышает 16 МиБ или имеет неверный Content-Length", 413)
  }
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = request.body?.getReader()
  if (reader !== undefined) {
    try {
      while (true) {
        request.signal.throwIfAborted()
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > maxBodyBytes) throw new ToolError("LIMIT_EXCEEDED", "Тело команды превышает 16 МиБ", 413)
        chunks.push(chunk.value)
      }
    } catch (error) {
      await reader.cancel().catch(() => {})
      throw error
    } finally {
      reader.releaseLock()
    }
  }
  let input: unknown
  try { input = JSON.parse(Buffer.concat(chunks, size).toString("utf8")) }
  catch { throw new ToolError("INVALID_INPUT", "Ожидается JSON-команда {name, arguments}") }
  const command = object(input, ["name", "arguments"])
  const name = identity(command.name, "name")
  if (name.length > 128) throw new ToolError("INVALID_INPUT", "Имя команды превышает 128 символов")
  if (!Object.hasOwn(command, "arguments") || command.arguments === null
    || typeof command.arguments !== "object" || Array.isArray(command.arguments)) {
    throw new ToolError("INVALID_INPUT", "arguments является объектом аргументов команды")
  }
  return {name, arguments: command.arguments as Record<string, unknown>}
}

export function failure(cause: unknown): {error: Failure, status: number} {
  const error = ToolError.from(cause)
  return {
    error: {code: error.code, message: error.message, ...(error.details === undefined ? {} : {details: error.details})},
    status: error.status,
  }
}

export function reply(value: unknown, id: string, status = 200): Response {
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-request-id": id,
  }
  if (status === 401) headers["www-authenticate"] = "Bearer"
  if (status === 405) headers.allow = "GET, POST"
  return Response.json(value, {status, headers})
}
