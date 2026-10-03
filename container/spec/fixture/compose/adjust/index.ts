/**
Вложенный контейнер использует принадлежащий ему компонент увеличения числа.

@packageDocumentation
*/
import increment from "@fixture/compose-increment"
import type {FixtureComposeAdjust} from "./contract"

export type {FixtureComposeAdjust} from "./contract"

/** Возвращает результат единственной части композиции. */
export default function adjust(value: FixtureComposeAdjust.Input): FixtureComposeAdjust.Output {
  return increment(value)
}
