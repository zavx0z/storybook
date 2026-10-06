import {createHash} from "node:crypto"
import {constants} from "node:fs"
import {open} from "node:fs/promises"

/** Читает явно объявленный источник. Текст живёт в ответе, отдельный постоянный кеш не создаётся. */
export async function readSource(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error("Источник окружения должен быть обычным файлом до 8 МиБ")
    const content = await file.readFile("utf8")
    return {content, contentHash: createHash("sha256").update(content).digest("hex")}
  } finally { await file.close() }
}
