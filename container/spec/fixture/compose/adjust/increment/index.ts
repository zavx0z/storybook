/**
Увеличивает переданное число на единицу.

@packageDocumentation
*/
import type {FixtureComposeIncrement} from "./contract"

export type {FixtureComposeIncrement} from "./contract"

/** Увеличивает переданное число на единицу. */
export default function increment(value: FixtureComposeIncrement.Input): FixtureComposeIncrement.Output {
  return value + 1
}
