/**
Увеличивает переданное число на единицу.

@packageDocumentation
*/
import type {Input} from "./contract/input"
import type {Output} from "./contract/output"

export type {Input, Output}

/** Увеличивает переданное число на единицу. */
export default function increment(value: Input): Output {
  return value + 1
}
