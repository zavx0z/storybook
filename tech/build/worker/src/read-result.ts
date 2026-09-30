import {readFileSync, statSync} from "node:fs"

/** Отсутствие результата отличается от допустимого JSON null; прочие ошибки чтения сохраняются. */
export default function readWorkerResult(path: string, maximumBytes?: number): unknown {
  let size: number
  try {
    size = statSync(path).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
  if (maximumBytes !== undefined && size > maximumBytes) {
    throw new Error("Build worker result exceeds limit")
  }
  return JSON.parse(readFileSync(path, "utf8"))
}
