/**
Проверяет видимость путей через native Git без собственного parser `.gitignore`.

@packageDocumentation
*/
import {realpath} from "node:fs/promises"
import {dirname, resolve} from "node:path"
import type {ReadRouteIgnoredInput} from "./contract/input"
import type {ReadRouteIgnoredOutput} from "./contract/output"
import {isContained, runGit} from "./src/git"

export type {ReadRouteIgnoredInput, ReadRouteIgnoredOutput}

/**
Возвращает exclusions и reusable Git root одного traversal run.

@param input - Package root, проверяемые пути и необязательный известный Git root.
@returns Исключённые пути, repository identity и ancestor `.gitignore` markers.
*/
export async function readRouteIgnored({
  root,
  paths,
  repository,
}: ReadRouteIgnoredInput): Promise<ReadRouteIgnoredOutput> {
  const rootPath = await realpath(resolve(root))
  const absolutePaths = paths.map(path => resolve(path))
  if (absolutePaths.some(path => !isContained(rootPath, path))) {
    throw new TypeError("Git ignore query path выходит за package root")
  }

  let repositoryPath: string | null
  if (repository === undefined) {
    const result = await runGit(rootPath, ["rev-parse", "--show-toplevel"])
    if (result.code === 0) repositoryPath = await realpath(result.output.trim())
    else if (result.error.includes("not a git repository")) repositoryPath = null
    else throw new Error(result.error)
  } else if (repository === null) {
    repositoryPath = null
  } else {
    repositoryPath = await realpath(resolve(repository))
    if (!isContained(repositoryPath, rootPath)) {
      throw new TypeError("Git root не владеет package root")
    }
  }

  const watchPaths: string[] = []
  if (repositoryPath !== null) {
    for (let path = rootPath;; path = dirname(path)) {
      watchPaths.push(resolve(path, ".gitignore"))
      if (path === repositoryPath) break
      if (dirname(path) === path) throw new TypeError("Git root не является предком package root")
    }
  }
  if (repositoryPath === null || absolutePaths.length === 0) {
    return {ignored: [], repository: repositoryPath, watchPaths}
  }

  const result = await runGit(
    rootPath,
    ["check-ignore", "--no-index", "--stdin", "-z"],
    `${absolutePaths.join("\0")}\0`,
  )
  if (result.code !== 0 && result.code !== 1) throw new Error(result.error)
  return {
    ignored: result.output.split("\0").filter(Boolean),
    repository: repositoryPath,
    watchPaths,
  }
}
