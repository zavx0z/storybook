import {isCompiledTemplate} from "@zavx0z/template/compiled"
import type {ScenarioAppInput} from "./contract/input"
import type {ScenarioApp} from "./contract/output"

/**
Связывает общий Editor и единственный preview выбором варианта сценария.

Первый вариант открыт сразу. Выбор другого меняет только снимок props и
декларации; жизненным циклом semantic Document и монтированием владеет host.
*/
export function createScenarioApp(input: ScenarioAppInput): ScenarioApp {
  if (!isCompiledTemplate(input.template)) throw new TypeError("Фикстура сценария должна быть compiled template")
  const first = input.variants[0]
  if (first === undefined) throw new Error("Для просмотра сценария нужен хотя бы один вариант")
  const byId = new Map(input.variants.map(variant => [variant.id, variant]))
  if (byId.size !== input.variants.length) throw new Error("Идентификаторы вариантов сценария должны быть уникальны")
  let selected = first
  const listeners = new Set<() => void>()
  return Object.freeze({
    template: input.template,
    variants: input.variants,
    getSnapshot: () => selected,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    select(id: string) {
      const variant = byId.get(id)
      if (variant === undefined) throw new Error(`Неизвестный вариант сценария: ${id}`)
      if (variant === selected) return
      selected = variant
      for (const listener of listeners) listener()
    },
  })
}
