/**
Domain организует предметную область, её правила и принадлежащие ей пакеты.
Поддомен остаётся Domain. Собственная исполняемая композиция принадлежащих
частей оформляется как Container с собственным default и типами контракта.
Домен собирает именованный API и типы через реэкспорты публичных входов владельцев.
Условия exports выбирают вход среды; реэкспорт не передаёт владение реализацией.

@packageDocumentation
*/
import {basename, resolve} from "node:path"
import readPackage from "@archetypes/package"
import type {ReadDomainInput} from "./contract/input"
import type {ReadDomainOutput} from "./contract/output"

export type {ReadDomainInput, ReadDomainOutput}

/** Читает принадлежность кода и необязательные сценарии, не исполняя код проверяемого домена. */
export default async function readDomain({path}: ReadDomainInput): Promise<ReadDomainOutput> {
  const description = await readPackage({path})
  const owners = new Set(description.packages.map(item => item.path))
  const localCode: string[] = []
  for (const source of description.code) {
    if (source.statements.length === 0 && !source.exports.some(item => item.runtime && item.declarations.some(declaration => declaration.owner?.path === description.root))) continue
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
