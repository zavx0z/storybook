/**
Удваивает переданное число.

@packageDocumentation
*/
import type {Input} from "./contract/input"
import type {Output} from "./contract/output"

export type {Input, Output}

/** Удваивает переданное число. */
export default function double(value: Input): Output {
  return value * 2
}
