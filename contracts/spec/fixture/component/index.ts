/** Увеличивает значение; чтение контракта не выполняет эту реализацию. */
import type {Counter} from "./contract"
import {stepOf} from "./src/increment"

export type {Counter} from "./contract"

throw new Error("Исследуемый исходник не исполняется")

export default function increment(input: Counter.Input): number {
  return input.value + stepOf(input.step)
}
