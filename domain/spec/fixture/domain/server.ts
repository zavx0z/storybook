/**
Изменяет значение счётчика, сохраняя исходный снимок.

@packageDocumentation
*/
import type {FixtureArchetypeDomain} from "./contract/server"
export type {FixtureArchetypeDomain} from "./contract/server"

/** Возвращает следующий снимок общей сущности. */
export default function advanceCounter({counter, step}: FixtureArchetypeDomain.Input): FixtureArchetypeDomain.Output {
  return {value: counter.value + step}
}
