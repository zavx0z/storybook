import {createHash, randomUUID} from "node:crypto"
import {mkdir, readFile, link, unlink, writeFile} from "node:fs/promises"
import {dirname, join} from "node:path"
import type {Document} from "./document"
import {decodeDocument} from "./validation"
import {readMoveIntent} from "./relocation"

export function chatFile(directory: string, address: string, executorId?: string): string {
  const prefix = createHash("sha256").update(address).digest("hex")
  return join(directory, `${prefix}${executorId === undefined ? "" : `.${executorId}`}.json`)
}

/** Переносит прежнюю историю в хранилище владельца без перезаписи занятого назначения. */
export async function copyHistory(file: string, document: Document): Promise<Document> {
  await mkdir(dirname(file), {recursive: true})
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {mode: 0o600, flag: "wx"})
    await link(temporary, file)
    return document
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const concurrent = await readChatDocument(file, document.address)
    if (concurrent?.id !== document.id) throw new Error("Назначение уже занято другой историей")
    return concurrent
  } finally {
    await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error })
  }
}

export async function readChatDocument(file: string, address: string): Promise<Document | null> {
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
  const value: unknown = JSON.parse(text)
  const intent = await readMoveIntent(file)
  const patched = intent !== null && value !== null && typeof value === "object" && "id" in value && value.id === intent.id &&
    "address" in value && value.address === intent.from.address && !("executorId" in value)
    ? {...value, executorId: intent.executorId}
    : value
  const document = decodeDocument(patched, address)
  if (document === null) throw new Error(`Повреждена история чата ${address}`)
  if (value !== null && typeof value === "object" && "schemaVersion" in value && value.schemaVersion === 1) {
    await link(file, `${file}.schema1`).catch(error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error })
  }
  return document
}
