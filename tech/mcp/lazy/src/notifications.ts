import {watch, type FSWatcher} from "node:fs"
import {isAbsolute, relative, resolve, sep} from "node:path"

/** Изменение исходников инвалидирует списки. Переписки, meta и локальные артефакты не являются изменением MCP-возможностей. */
export function watchSourceChanges(input: Readonly<{
  root: string
  temporaryRoot: string
  onChanged(): Promise<void>
  onError(error: Error): void
}>): () => void {
  let watcher: FSWatcher | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  let notifications = Promise.resolve()
  const ignored = new Set(["node_modules", ".git", "tmp", "dist", "meta", ".local", ".cache", "coverage"])
  try {
    watcher = watch(input.root, {recursive: true}, (_event, filename) => {
      if (closed || filename === null) return
      const path = String(filename)
      if (!/\.(?:ts|tsx|js|json)$/u.test(path)) return
      if (path.split(/[\\/]/u).some(part => ignored.has(part))) return
      const fromTemporary = relative(input.temporaryRoot, resolve(input.root, path))
      if (fromTemporary === "" || !isAbsolute(fromTemporary) && fromTemporary !== ".." && !fromTemporary.startsWith(`..${sep}`)) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        notifications = notifications.then(async () => {
          if (!closed) await input.onChanged()
        }).catch(error => input.onError(error instanceof Error ? error : new Error(String(error))))
      }, 100)
    })
    watcher.on("error", input.onError)
  } catch (error) {
    input.onError(error instanceof Error ? error : new Error(String(error)))
  }
  return () => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    watcher?.close()
  }
}
