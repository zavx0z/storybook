/**
Repo — пакет-монорепозиторий с собственной историей и составом пакетов.
Project соединяет независимые Repo; вложенные самостоятельные репозитории
внутри одного Repo не входят в этот стандарт. Git-команды только читают состояние.

@packageDocumentation
*/
import {realpath, lstat} from "node:fs/promises"
import {resolve} from "node:path"
import {readPackage} from "@archetypes/package"
import type {ReadRepoInput} from "./contract/input"
import type {ReadRepoOutput} from "./contract/output"

export type {ReadRepoInput, ReadRepoOutput}

/** Читает точную Git-границу и gitlinks, сохраняя обычный пакет без Git как отрицательный пример. */
export async function readRepo({path}: ReadRepoInput): Promise<ReadRepoOutput> {
  const root = await realpath(resolve(path))
  const description = await readPackage({path: root})
  const git = Bun.spawn(["git", "-C", root, "rev-parse", "--show-toplevel"], {stdout: "pipe", stderr: "ignore"})
  const [output, code] = await Promise.all([new Response(git.stdout).text(), git.exited])
  const gitRoot = code === 0 ? await realpath(output.trim()) : null
  const nested = new Set<string>()
  for (const child of description.packages) {
    const marker = await lstat(resolve(child.path, ".git")).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return null
    })
    if (marker) nested.add(child.path)
  }
  if (gitRoot === root) {
    const list = Bun.spawn(["git", "-C", root, "ls-files", "--stage", "-z"], {stdout: "pipe", stderr: "ignore"})
    const [files, status] = await Promise.all([new Response(list.stdout).text(), list.exited])
    if (status !== 0) throw new Error("Не удалось прочитать состав Git репозитория")
    for (const entry of files.split("\0")) if (entry.startsWith("160000 ")) nested.add(resolve(root, entry.slice(entry.indexOf("\t") + 1)))
  }
  return {package: description, root, gitRoot, nestedRepositories: [...nested]}
}
