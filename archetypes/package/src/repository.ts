import {realpath, lstat} from "node:fs/promises"
import {resolve} from "node:path"
import type {ReadPackageOutput} from "../contract/output"

/** Читает Git-корень и вложенные gitlinks, не меняя историю или рабочее дерево. */
export async function readRepositoryBoundary(
  root: string,
  packages: ReadPackageOutput["packages"],
): Promise<ReadPackageOutput["repository"]> {
  const git = Bun.spawn(["git", "-C", root, "rev-parse", "--show-toplevel"], {stdout: "pipe", stderr: "ignore"})
  const [output, code] = await Promise.all([new Response(git.stdout).text(), git.exited])
  const gitRoot = code === 0 ? await realpath(output.trim()) : null
  const nested = new Set<string>()
  for (const child of packages) {
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
  return {gitRoot, nestedRepositories: [...nested]}
}
