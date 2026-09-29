/**
Увеличивает переданное число на единицу без состояния и подписок.

@packageDocumentation
*/
import type {Input} from "./contract/input"
import type {Output} from "./contract/output"
export type {Input, Output}

/** Возвращает новое значение без изменения аргумента. */
export default function increment({value}: Input): Output {
  return value + 1
}
