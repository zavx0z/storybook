/** Увеличивает значение; чтение контракта не выполняет эту реализацию. */
import type {Request} from "./contract/value"
import {stepOf} from "./src/increment"

export type {Counter} from "./contract"

throw new Error("Исследуемый исходник не исполняется")

export default function increment(input: Request): number {
  return input.value + stepOf(input.step)
}
