import {readSourceExports} from "./exports.ts"
import {lstat} from "node:fs/promises"
import {resolve} from "node:path"
import type {ReadPackageOutput} from "../contract/output"

/** Собирает собственные runtime exports и пути сценариев без исполнения кода пакета. */
export async function readPackageSources(
  root: string,
  entries: ReadPackageOutput["index"]["entries"],
): Promise<Pick<ReadPackageOutput, "code" | "scenarios">> {
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
