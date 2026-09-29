/**
Component владеет конкретным поведением, публичным контрактом и своей реализацией.
Он может использовать и содержать другие компоненты, оставаясь Component.
Состояние, подписки, визуальность и среда исполнения не являются обязательными.
Самостоятельные внутренние предметы получают пакеты; частные помощники остаются в src.

@packageDocumentation
*/
import {lstat, readFile} from "node:fs/promises"
import {resolve} from "node:path"
import {readPackage} from "@archetypes/package"
import type {ReadComponentInput} from "./contract/input"
import type {ReadComponentOutput} from "./contract/output"

export type {ReadComponentInput, ReadComponentOutput}

/** Сканирует публичные входы без исполнения и без генерации bundle. */
export async function readComponent({path}: ReadComponentInput): Promise<ReadComponentOutput> {
  const description = await readPackage({path})
  const entries: ReadComponentOutput["entries"][number][] = []
  for (const entry of description.index.entries) {
    if (entry.path !== "." || entry.status !== "owned" || !entry.code || !entry.target) continue
    const source = resolve(path, entry.target)
    const jsx = /\.[jt]sx$/u.test(source)
    const scanner = new Bun.Transpiler({loader: jsx ? "tsx" : "ts"})
    entries.push({path: source, exports: scanner.scan(await readFile(source, "utf8")).exports,
      input: entry.input, output: entry.output, jsx})
  }
  const scenarios: string[] = []
  for (const file of ["spec/scenario.spec.ts", "spec/scenario.spec.tsx"]) {
    const source = resolve(path, file)
    const info = await lstat(source).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return null
    })
    if (info?.isFile() && !info.isSymbolicLink()) scenarios.push(source)
  }
  return {package: description, entries, scenarios,
    additionalCode: description.index.entries.filter(entry => entry.code && entry.status !== "blocked" && (entry.path !== "." || entry.status !== "owned")).map(entry => entry.path)}
}
