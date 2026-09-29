/**
Domain организует предметную область, её правила и принадлежащие ей пакеты.
Поддомен остаётся Domain. Домен не является одновременно Component:
исполняемая композиция получает собственный пакет компонента.
Публичный подпуть домена может прямо открывать публичный вход вложенного владельца.

@packageDocumentation
*/
import {lstat, readFile} from "node:fs/promises"
import {resolve} from "node:path"
import {readPackage} from "@archetypes/package"
import type {ReadDomainInput} from "./contract/input"
import type {ReadDomainOutput} from "./contract/output"

export type {ReadDomainInput, ReadDomainOutput}

/** Читает принадлежность кода и необязательные сценарии, не исполняя код проверяемого домена. */
export async function readDomain({path}: ReadDomainInput): Promise<ReadDomainOutput> {
  const description = await readPackage({path})
  const owners = new Set(description.packages.map(item => item.path))
  const localCode: string[] = []
  const inspected = new Set<string>()
  for (const entry of description.index.entries) {
    if (!entry.code || entry.status !== "owned" || !entry.target) continue
    const source = resolve(path, entry.target)
    inspected.add(source)
    const scanner = new Bun.Transpiler({loader: entry.target.endsWith("x") ? "tsx" : "ts"})
    if (scanner.scan(await readFile(source, "utf8")).exports.length > 0) localCode.push(entry.path)
  }
  // Необъявленный корневой Component тоже не должен маскироваться под Domain.
  for (const name of ["index.tsx", "index.ts"]) {
    const source = resolve(path, name)
    const info = await lstat(source).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return null
    })
    if (!info?.isFile() || info.isSymbolicLink()) continue
    if (!inspected.has(source)) {
      const scanner = new Bun.Transpiler({loader: name.endsWith("x") ? "tsx" : "ts"})
      if (scanner.scan(await readFile(source, "utf8")).exports.length > 0) localCode.push(name)
    }
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
  return {
    package: description,
    localCode,
    undeclaredOwners: [...new Set(description.index.entries.flatMap(entry => entry.owner && !owners.has(entry.owner.path) ? [entry.owner.path] : []))],
    scenarios,
  }
}
