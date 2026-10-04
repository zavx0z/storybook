/**
Cluster группирует самостоятельных участников по общему протоколу.
Общее соглашение принадлежит кластеру, реализации и расширения — участникам.
Читатель раскрывает происхождение символов и native типовые связи без исполнения;
поведение общего протокола подтверждается сценариями участников.

@packageDocumentation
*/
import {resolve} from "node:path"
import readPackage from "@zavx0z/storybook-package-reader"
import readContract from "@zavx0z/storybook-contracts"
import type {StorybookCluster} from "./contract"

export type {StorybookCluster} from "./contract"

/** Возвращает владельцев реализаций и отношения протоколов из публичного входа группы. */
export default async function readCluster({path}: StorybookCluster.Input): Promise<StorybookCluster.Output> {
  const description = await readPackage({path})
  const entries = new Set(description.index.entries.filter(entry => entry.path === "." && entry.target)
    .map(entry => resolve(description.root, entry.target!)))
  const members = [...new Map(description.code.filter(source => entries.has(source.path))
    .flatMap(source => source.exports.filter(value => value.runtime).flatMap(value => value.declarations))
    .flatMap(value => value.owner && value.owner.path !== description.root ? [[value.owner.path, value.owner] as const] : [])).values()]
  return {package: description, protocols: await readContract({path: description.root}), members}
}
