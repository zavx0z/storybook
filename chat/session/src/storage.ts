import {createHash} from "node:crypto"
import {access, copyFile, mkdir} from "node:fs/promises"
import {constants} from "node:fs"
import {dirname, join} from "node:path"
import type {ArchiveMetadata} from "./archive"
import {copyArchive, openArchive, readArchiveState} from "./archive"
import {readMoveIntent} from "./relocation"

type CompactDocument = ArchiveMetadata & {schemaVersion: 3}

export function chatFile(directory: string, address: string, executorId?: string, sessionId?: string): string {
  const prefix = createHash("sha256").update(address).digest("hex")
  return join(directory, `${prefix}${executorId === undefined ? "" : `.${executorId}`}${sessionId === undefined ? "" : `.${sessionId}`}.json`)
}

/** Переносит весь корпус, сохраняя исходный архив и identity назначения. */
export async function copyHistory(file: string, document: CompactDocument, sourceFile?: string): Promise<CompactDocument> {
  const existing = await readChatDocument(file, document.address)
  if (existing !== null) {
    if (existing.id !== document.id) throw new Error("Назначение уже занято другой историей")
    return existing
  }
  const {schemaVersion, ...metadata} = document
  if (sourceFile !== undefined) await copyArchive(sourceFile, file, metadata)
  else {
    const archive = await openArchive(file, metadata)
    try { await archive.commit(metadata) } finally { await archive.dispose() }
  }
  return document
}

/** Читает компактный header; миграция legacy выполняется архивом один раз. */
export async function readChatDocument(file: string, address: string): Promise<CompactDocument | null> {
  try { await access(`${file}.deleted`); return null } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  try { await access(file) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
  const saved = await readArchiveState(file)
  if (saved !== null) {
    if (saved.metadata.address !== address) throw new Error(`Повреждена история чата ${address}`)
    return {...saved.metadata, schemaVersion: 3}
  }
  const intent = await readMoveIntent(file)
  const archive = await openArchive(file, {address, ...(intent === null ? {} : {executorId: intent.executorId})} as ArchiveMetadata)
  try {
    if (archive.metadata.address !== address) throw new Error(`Повреждена история чата ${address}`)
    return {...archive.metadata, schemaVersion: 3}
  } finally { await archive.dispose() }
}

/** Общий прежний файл остаётся нетронутым; мигрирует только копия владельца. */
export async function importLegacy(source: string, file: string, address: string): Promise<CompactDocument | null> {
  try { await access(`${file}.deleted`); return null } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  try { await access(source) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
  await mkdir(dirname(file), {recursive: true})
  try { await copyFile(source, file, constants.COPYFILE_EXCL) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  }
  return await readChatDocument(file, address)
}
