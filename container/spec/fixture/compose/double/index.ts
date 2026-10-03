/**
Удваивает переданное число.

@packageDocumentation
*/
import type {FixtureComposeDouble} from "./contract"

export type {FixtureComposeDouble} from "./contract"

/** Удваивает переданное число. */
export default function double(value: FixtureComposeDouble.Input): FixtureComposeDouble.Output {
  return value * 2
}
