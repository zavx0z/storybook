/**
Читает один уровень package-owned директорий по общим правилам видимости.

@packageDocumentation
*/
import {realpath} from "node:fs/promises"
import {resolve} from "node:path"
import {readRouteIgnored} from "../ignored"
import type {ReadRouteDirectoriesInput} from "./contract/input"
import type {ReadRouteDirectoriesOutput} from "./contract/output"
import {isContained, pathExists, readDirectoryCandidates, readDirectoryShape, readExactDirectory} from "./src/files"

export type {ReadRouteDirectoriesInput, ReadRouteDirectoriesOutput}

/**
Возвращает видимые непосредственные директории в лексикографическом порядке имён.
Git exclusions проверяет native `git check-ignore`; TypeScript не загружается.

@param input - Package root, непосредственный parent и известные nested packages.
@returns Обычные non-symlink директории с классификацией ближайшей module boundary.
*/
export async function readRouteDirectories({
  root,
  parent,
  name,
  packagePaths = [],
  repository,
}: ReadRouteDirectoriesInput): Promise<ReadRouteDirectoriesOutput> {
  const rootPath = await readExactDirectory(root)
  const parentPath = await readExactDirectory(parent)
  if (rootPath === null || parentPath === null || !isContained(rootPath, parentPath)) {
    return {directories: [], watchPaths: []}
  }

  const candidates = await readDirectoryCandidates(parentPath, name, packagePaths)
  const ignoredResult = await readRouteIgnored({
    root: rootPath,
    paths: candidates.flatMap(candidate => [
      candidate.path,
      resolve(candidate.path, "index.tsx"),
      resolve(candidate.path, "index.ts"),
    ]),
    ...(repository === undefined ? {} : {repository}),
  })
  const ignored = new Set(ignoredResult.ignored)
  const watchPaths = new Set([
    ...ignoredResult.watchPaths,
    parentPath,
    resolve(parentPath, ".gitignore"),
  ])
  const result: {
    name: string
    path: string
    entry: "tsx" | "ts" | null
    module: boolean
  }[] = []

  for (const candidate of candidates) {
    const {path} = candidate
    if (ignored.has(path)) continue
    const canonical = await realpath(path).catch(() => null)
    if (canonical !== path || !isContained(rootPath, canonical)) continue
    const packageJson = resolve(path, "package.json")
    watchPaths.add(packageJson)
    if (await pathExists(packageJson)) continue

    for (const watched of [
      path,
      resolve(path, ".gitignore"),
      resolve(path, "index.tsx"),
      resolve(path, "index.ts"),
      resolve(path, "src"),
    ]) watchPaths.add(watched)
    const shape = await readDirectoryShape(path, ignored)
    result.push({
      name: candidate.name,
      path,
      ...shape,
    })
  }
  return {directories: result, watchPaths: [...watchPaths]}
}
