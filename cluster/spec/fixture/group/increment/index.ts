/**
Увеличивает исходное значение без состояния и изменения аргумента.

@packageDocumentation
*/
import type {FixtureIncrement} from "./contract"
export type {FixtureIncrement} from "./contract"

/** Свой шаг расширяет общий протокол числовой операции. */
export default function increment({value, step = 1}: FixtureIncrement.Input): FixtureIncrement.Output {
  return value + step
}
