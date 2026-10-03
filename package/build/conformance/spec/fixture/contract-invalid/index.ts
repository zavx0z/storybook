/**
Увеличивает число; ошибочная роль видна только в контракте.

@packageDocumentation
*/
import type {FixtureConformanceContractInvalid} from "./contract"

export type {FixtureConformanceContractInvalid} from "./contract"

export default function run(input: FixtureConformanceContractInvalid.Input): FixtureConformanceContractInvalid.Output {
  return input.value + 1
}
