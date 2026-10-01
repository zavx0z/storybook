/**
Project объединяет выбранные независимые пакеты-репозитории.
Один Repo может участвовать в нескольких проектах без копирования кода,
пакетной идентичности и истории. Дополнительная файловая оболочка не требуется.

@packageDocumentation
*/
import {realpath} from "node:fs/promises"
import {relative, resolve, sep} from "node:path"
import readRepo from "@archetypes/repo"
import type {ArchetypesProject} from "./contract"

export type {ArchetypesProject} from "./contract"

/** Читает ссылки проекта; не создаёт репозитории, копии или ветки Git. */
export default async function readProject({paths}: ArchetypesProject.Input): Promise<ArchetypesProject.Output> {
  const roots = [...new Set(await Promise.all(paths.map(path => realpath(resolve(path)))))]
  const repositories = await Promise.all(roots.map(path => readRepo({path})))
  const names = repositories.map(repo => repo.package.packageJson.name)
  return {
    repositories,
    duplicateNames: [...new Set(names.filter((name, index) => names.indexOf(name) !== index))],
    nestedRoots: roots.filter(path => roots.some(parent => {
      if (path === parent) return false
      const child = relative(parent, path)
      return child !== ".." && !child.startsWith(`..${sep}`) && !child.startsWith(sep)
    })),
  }
}
