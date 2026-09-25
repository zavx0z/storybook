import {constants} from "node:fs"
import {lstat, open} from "node:fs/promises"
import {resolve} from "node:path"
import {readModuleDocumentation} from "@archetypes/package/documentation"
import type {ReadModuleDocumentationOutput} from "@archetypes/package/documentation"

const MAX_MODULE_SOURCE_BYTES = 1024 * 1024

/**
Читает описание непосредственного входа пакета. `index.tsx` имеет приоритет;
ссылка и специальный файл не раскрываются, превышение лимита прерывает чтение.
*/
export async function readRootDocumentation(directory: string): Promise<ReadModuleDocumentationOutput | null> {
  for (const name of ["index.tsx", "index.ts"]) {
    const path = resolve(directory, name)
    let metadata
    try {
      metadata = await lstat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
      throw error
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) continue
    if (metadata.size > MAX_MODULE_SOURCE_BYTES) throw new RangeError(`Module source exceeds ${MAX_MODULE_SOURCE_BYTES} bytes: ${path}`)
    let handle
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOOP" || (error as NodeJS.ErrnoException).code === "ENOENT") continue
      throw error
    }
    try {
      const opened = await handle.stat()
      if (!opened.isFile()) continue
      if (opened.size > MAX_MODULE_SOURCE_BYTES) throw new RangeError(`Module source exceeds ${MAX_MODULE_SOURCE_BYTES} bytes: ${path}`)
      const buffer = Buffer.allocUnsafe(MAX_MODULE_SOURCE_BYTES + 1)
      let length = 0
      while (length < buffer.length) {
        const {bytesRead} = await handle.read(buffer, length, buffer.length - length, length)
        if (bytesRead === 0) break
        length += bytesRead
      }
      if (length > MAX_MODULE_SOURCE_BYTES) throw new RangeError(`Module source exceeds ${MAX_MODULE_SOURCE_BYTES} bytes: ${path}`)
      return readModuleDocumentation({source: buffer.toString("utf8", 0, length), path})
    } finally {
      await handle.close()
    }
  }
  return null
}
