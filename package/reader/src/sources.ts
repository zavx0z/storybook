import {readSourceExports} from "./exports.ts"
import {lstat, readdir} from "node:fs/promises"
import {resolve} from "node:path"
import type {ArchetypesPackage} from "../contract"

/**
Собирает собственные исходники и сценарии без исполнения кода пакета.
В src находятся также самостоятельные browser/worker/transport входы: отсутствие
статического импорта из index не переносит их ответственность к другому владельцу.
Вложенные пакеты, тесты и символические ссылки в этот исходный набор не входят.
*/
export async function readPackageSources(
  root: string,
  entries: ArchetypesPackage.Output["index"]["entries"],
): Promise<Pick<ArchetypesPackage.Output, "code" | "scenarios">> {
  const paths = new Set(entries.filter(entry => entry.code && entry.status === "owned" && entry.target)
    .map(entry => resolve(root, entry.target!)))
  for (const name of ["index.tsx", "index.ts"]) {
    const path = resolve(root, name)
    const info = await lstat(path).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return null
    })
    if (info?.isFile() && !info.isSymbolicLink()) paths.add(path)
  }
  const collectOwnedSource = async (directory: string): Promise<void> => {
    const info = await lstat(directory).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return null
    })
    if (!info?.isDirectory() || info.isSymbolicLink()) return
    if (await lstat(resolve(directory, "package.json")).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return null
    })) return
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".")
        || ["node_modules", "spec", "test", "tests", "fixture", "fixtures", "dist"].includes(entry.name)) continue
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) await collectOwnedSource(path)
      else if (entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name)
        && !/\.(?:test|spec|fixture)\.[cm]?[jt]sx?$/u.test(entry.name)) paths.add(path)
    }
  }
  await collectOwnedSource(resolve(root, "src"))
  const code = await readSourceExports(root, [...paths])
  const scenarios: string[] = []
  for (const name of ["scenario.spec.ts", "scenario.spec.tsx"]) {
    const path = resolve(root, "spec", name)
    const info = await lstat(path).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return null
    })
    if (info?.isFile() && !info.isSymbolicLink()) scenarios.push(path)
  }
  return {code, scenarios}
}
