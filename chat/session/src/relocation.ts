import {randomUUID} from "node:crypto"
import {link, mkdir, readFile, unlink, writeFile} from "node:fs/promises"
import {dirname, isAbsolute, relative, resolve} from "node:path"
import type {Document} from "./document"

/** Durable intent закрывает source до копирования, оставляя исходную историю для восстановления. */
export type MoveIntent = Readonly<{
  schemaVersion: 1
  id: string
  executorId: string
  from: Readonly<{address: string, cwd: string}>
  to: Readonly<{address: string, cwd: string}>
}>

export async function readMoveIntent(file: string): Promise<MoveIntent | null> {
  const text = await readFile(`${file}.relocated`, "utf8").catch(error => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    return null
  })
  if (text === null) return null
  const value: unknown = JSON.parse(text)
  if (value === null || typeof value !== "object") throw new Error("Повреждён intent переноса беседы")
  const move = value as Partial<Omit<MoveIntent, "schemaVersion">> & {schemaVersion?: number}
  if (![1, 2].includes(move.schemaVersion!) || typeof move.id !== "string" || typeof move.executorId !== "string" ||
    typeof move.from?.address !== "string" || typeof move.to?.address !== "string" ||
    typeof move.from.cwd !== "string" || typeof move.to.cwd !== "string" ||
    !move.from.cwd || !move.to.cwd ||
    (move.schemaVersion === 1 ? !isAbsolute(move.from.cwd) || !isAbsolute(move.to.cwd) : isAbsolute(move.from.cwd) || isAbsolute(move.to.cwd))) {
    throw new Error("Повреждён intent переноса беседы")
  }
  return {schemaVersion: 1, id: move.id, executorId: move.executorId,
    from: {...move.from, cwd: resolve(dirname(file), move.from.cwd)},
    to: {...move.to, cwd: resolve(dirname(file), move.to.cwd)}}
}

export function sameMove(a: MoveIntent, b: MoveIntent): boolean {
  return a.id === b.id && a.executorId === b.executorId && a.from.address === b.from.address &&
    a.from.cwd === b.from.cwd && a.to.address === b.to.address && a.to.cwd === b.to.cwd
}

/** Intent создаётся без перезаписи; повтор другого mapping не меняет предыдущий перенос. */
export async function writeMoveIntent(file: string, intent: MoveIntent): Promise<void> {
  await mkdir(dirname(file), {recursive: true})
  const temporary = `${file}.${randomUUID()}.move.tmp`
  try {
    const stored = {...intent, schemaVersion: 2,
      from: {...intent.from, cwd: relative(dirname(file), intent.from.cwd) || "."},
      to: {...intent.to, cwd: relative(dirname(file), intent.to.cwd) || "."}}
    await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, {mode: 0o600, flag: "wx"})
    await link(temporary, `${file}.relocated`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const previous = await readMoveIntent(file)
    if (previous === null || !sameMove(previous, intent)) throw new Error("Беседа уже переносится по другому соответствию")
  } finally {
    await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error })
  }
}

/** Архивная source identity не является вторым активным исполнителем. */
export async function movedSource(file: string, document: Pick<Document, "id" | "executorId" | "address">): Promise<MoveIntent | null> {
  const move = await readMoveIntent(file)
  return move?.id === document.id && move.from.address === document.address ? move : null
}
