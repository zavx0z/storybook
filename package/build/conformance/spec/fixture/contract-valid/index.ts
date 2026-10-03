/**
Увеличивает число через принадлежащий реализации helper.

@packageDocumentation
*/
import type {FixtureConformanceContractValid} from "./contract"
import {increment} from "./src/increment"

export type {FixtureConformanceContractValid} from "./contract"

export default function run(input: FixtureConformanceContractValid.Input): FixtureConformanceContractValid.Output {
  return increment(input.value)
}
