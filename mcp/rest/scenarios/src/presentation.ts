import {dirname, resolve} from "node:path"
import type {ScenariosInput, ScenariosDocumentOptions, ScenariosOutput, ScenariosDocument} from "./types"
import {presentDocument} from "./document"

/** Формирует каталог из готового отчёта; исходные данные валидации остаются неизменными. */
export function presentScenarios(input: ScenariosInput): ScenariosOutput
export function presentScenarios(input: ScenariosInput, options: ScenariosDocumentOptions): ScenariosDocument
export function presentScenarios(input: ScenariosInput, options?: ScenariosDocumentOptions): ScenariosOutput | ScenariosDocument
export function presentScenarios(input: ScenariosInput, options?: ScenariosDocumentOptions): ScenariosOutput | ScenariosDocument {
  const owner = {...input.owner, path: resolve(input.owner.path)}
  const source = input.source === null ? null : resolve(input.source)
  if (source !== null && (dirname(source) !== resolve(owner.path, "spec") || !/\/scenario\.spec\.tsx?$/u.test(source))) {
    throw new Error("Сценарий не принадлежит непосредственно выбранному владельцу")
  }
  if (input.prepared && (!source || resolve(input.prepared.result.path) !== source)) throw new Error("Результат относится к другому сценарию")
  if (!input.prepared) {
    const data: ScenariosOutput = {owner, source, status: source === null ? "absent" : "pending", revision: null, validation: null, variants: [], items: []}
    return options ? presentDocument(data, options) : data
  }
  if (!input.prepared.revision.trim()) throw new Error("Не указана ревизия результата")
  const {result, revision} = input.prepared
  type Category = Omit<ScenariosOutput["variants"][number], "categories" | "items"> & {categories: Category[], items: ScenariosOutput["items"][number][]}
  const categories = new Map<number, Category>()
  const variants: Category[] = []
  for (const group of result.groups) {
    if (categories.has(group.id)) throw new Error("Повторный идентификатор группы")
    const category: Category = {id: group.id, label: group.label, location: {...group.location}, parameters: structuredClone(group.parameters), categories: [], items: []}
    categories.set(group.id, category)
    if (group.parentId === null) variants.push(category)
    else {
      const parent = categories.get(group.parentId)
      if (!parent || parent === category) throw new Error("Нарушена принадлежность группы")
      parent.categories.push(category)
    }
  }
  const items: ScenariosOutput["items"][number][] = []
  const ids = new Set<number>()
  for (const test of result.tests) {
    if (ids.has(test.id)) throw new Error("Повторный идентификатор пункта")
    ids.add(test.id)
    const assertions = result.assertions.filter(assertion => assertion.testId === test.id)
    const reached = new Set(assertions.map(assertion => assertion.site))
    const item = {
      id: test.id, groupId: test.groupId, label: test.label, location: {...test.location}, status: test.status, message: test.message,
      skipReason: test.skipReason, assertions: structuredClone(assertions),
      unexecuted: structuredClone(test.assertions.filter(assertion => !reached.has(assertion.site))),
    }
    if (test.groupId === null) items.push(item)
    else {
      const category = categories.get(test.groupId)
      if (!category) throw new Error("Не найдена категория пункта")
      category.items.push(item)
    }
  }
  const data: ScenariosOutput = {owner, source, status: "ready", revision, validation: structuredClone(result.validation), variants, items}
  return options ? presentDocument(data, options) : data
}
