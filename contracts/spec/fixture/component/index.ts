/** Увеличивает значение; чтение контракта не выполняет эту реализацию. */
import type {ContractFixtureCounter} from "./contract"
import {stepOf} from "./src/increment"

export type {ContractFixtureCounter} from "./contract"

throw new Error("Исследуемый исходник не исполняется")

export default function increment(input: ContractFixtureCounter.Input): number {
  return input.value + stepOf(input.step)
}
