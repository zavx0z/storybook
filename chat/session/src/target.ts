import type {Target} from "../contract/target"

/** UUID применяется только как identity и безопасный суффикс файла, не как адрес предмета. */
export function executorIdentity(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value)) {
    throw new TypeError("Нужен UUID существующего исполнителя")
  }
  return value.toLowerCase()
}

/** Различает default адрес и точный выбор, сохраняя проверку самого адреса у каталога. */
export function targetParts(target: Target): {address: string, executorId?: string, sessionId?: string} {
  if (typeof target === "string") return {address: target}
  if (target === null || typeof target !== "object" || typeof target.address !== "string") {
    throw new TypeError("Нужен адрес либо точный адрес и UUID исполнителя")
  }
  if (target.sessionId !== undefined && (typeof target.sessionId !== "string" || target.sessionId.length === 0 || target.sessionId.length > 4096)) throw new TypeError("Нужна точная локальная identity сессии")
  return {address: target.address, executorId: executorIdentity(target.executorId), ...(target.sessionId === undefined ? {} : {sessionId: target.sessionId})}
}

/** Default и именованная беседа одного адреса имеют разные ключи runtime. */
export function targetKey(address: string, executorId?: string, sessionId?: string): string {
  return JSON.stringify([address, executorId ?? null, sessionId ?? null])
}
