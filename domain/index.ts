/**
Domain связывает общие правила одной сущности с её средовыми реализациями.
Каждый основной вход предоставляет одну реализацию и её протокол.
Читатель сохраняет условия входов и общие исходные определения протоколов,
включая делегирование принадлежащему Component или Container.
Общий index не обязателен; код исследуемых реализаций не исполняется.

@packageDocumentation
*/
import readPackage from "@archetypes/package"
import readContract from "@archetypes/contracts"
import type {ArchetypesDomain} from "./contract"

export type {ArchetypesDomain} from "./contract"

/** Читает средовые протоколы и их общие определения без запуска реализаций. */
export default async function readDomain({path}: ArchetypesDomain.Input): Promise<ArchetypesDomain.Output> {
  const description = await readPackage({path})
  const protocols = await readContract({path: description.root})
  const entries = protocols.entries.filter(entry => entry.exportPath === ".")
  const definitions = entries.map(entry => entry.namespaces.flatMap(namespace =>
    namespace.roles.flatMap(role => role.dependencies)))
  const sharedDefinitions = [...new Map((definitions[0] ?? []).filter(source => definitions.every(values =>
    values.some(value => value.path === source.path && value.line === source.line && value.name === source.name)))
    .map(source => [`${source.path}:${source.line}:${source.name}`, source])).values()]
  return {
    package: description,
    protocols,
    sharedDefinitions,
    scenarios: description.scenarios,
  }
}
