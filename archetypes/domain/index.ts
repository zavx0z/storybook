/**
Domain организует предметную область, её правила и принадлежащие ей пакеты.
Поддомен остаётся Domain. Домен не является одновременно Component:
исполняемая композиция получает собственный пакет компонента.
Публичный подпуть домена может прямо открывать публичный вход вложенного владельца.

@packageDocumentation
*/
import {basename, resolve} from "node:path"
import {readPackage} from "@archetypes/package"
import type {ReadDomainInput} from "./contract/input"
import type {ReadDomainOutput} from "./contract/output"

export type {ReadDomainInput, ReadDomainOutput}

/** Читает принадлежность кода и необязательные сценарии, не исполняя код проверяемого домена. */
export async function readDomain({path}: ReadDomainInput): Promise<ReadDomainOutput> {
  const description = await readPackage({path})
  const owners = new Set(description.packages.map(item => item.path))
  const localCode: string[] = []
  for (const source of description.code) {
    if (source.exports.length === 0) continue
    const entry = description.index.entries.find(entry => entry.status === "owned" && entry.target
      && resolve(description.root, entry.target) === source.path)
    localCode.push(entry?.path ?? basename(source.path))
  }
  return {
    package: description,
    localCode,
    undeclaredOwners: [...new Set(description.index.entries.flatMap(entry => entry.owner && !owners.has(entry.owner.path) ? [entry.owner.path] : []))],
    scenarios: description.scenarios,
  }
}
