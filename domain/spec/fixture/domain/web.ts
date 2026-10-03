/**
Показывает значение счётчика в текстовом представлении.

@packageDocumentation
*/
import type {FixtureArchetypeDomain} from "./contract/web"
export type {FixtureArchetypeDomain} from "./contract/web"

/** Общая величина сохраняется; представление добавляет только подпись. */
export default function showCounter({counter, prefix = ""}: FixtureArchetypeDomain.Input): FixtureArchetypeDomain.Output {
  return `${prefix}${counter.value}`
}
