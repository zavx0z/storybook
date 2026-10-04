/** Увеличивает значение; чтение контракта не выполняет эту реализацию. */
import type {StorybookContractsSpecFixtureComponent} from "./contract"
import {stepOf} from "./src/increment"

export type {StorybookContractsSpecFixtureComponent} from "./contract"

throw new Error("Исследуемый исходник не исполняется")

export default function increment(input: StorybookContractsSpecFixtureComponent.Input): number {
  return input.value + stepOf(input.step)
}
