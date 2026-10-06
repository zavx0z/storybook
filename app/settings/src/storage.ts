import {createHash, randomUUID} from "node:crypto"
import {mkdir, readFile, rename, unlink, writeFile} from "node:fs/promises"
import {dirname, isAbsolute, join} from "node:path"
import type {StorybookAppSettings} from "../contract"

type ExecutorInput = Parameters<StorybookAppSettings.Output["readExecutor"]>[0]
const pendingWrites = new Map<string, Promise<void>>()

export const exclusive = <T>(file: string, action: () => Promise<T>): Promise<T> => {
  const pending = (pendingWrites.get(file) ?? Promise.resolve()).then(action, action)
  const settled = pending.then(() => {}, () => {})
  pendingWrites.set(file, settled)
  void settled.then(() => { if (pendingWrites.get(file) === settled) pendingWrites.delete(file) })
  return pending
}

export const readJson = async (path: string): Promise<unknown> => {
  try { return JSON.parse(await readFile(path, "utf8")) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

export const save = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), {recursive: true})
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {flag: "wx", mode: 0o600})
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error })
  }
}

export const executorFile = (value: ExecutorInput): string => {
  if (!isAbsolute(value.subject.cwd) || typeof value.executorId !== "string" || !value.executorId.trim()) throw new TypeError("Нужны предмет и identity исполнителя")
  return join(value.subject.cwd, "meta/settings/executors", `${createHash("sha256").update(value.executorId).digest("hex")}.json`)
}
