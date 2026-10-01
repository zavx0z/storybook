/**
Вложенный контейнер использует принадлежащий ему компонент увеличения числа.

@packageDocumentation
*/
import increment from "@fixture/compose-increment"
import type {Input} from "./contract/input"
import type {Output} from "./contract/output"

export type {Input, Output}

/** Возвращает результат единственной части композиции. */
export default function adjust(value: Input): Output {
  return increment(value)
}
