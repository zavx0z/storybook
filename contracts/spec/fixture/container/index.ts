import part from "./part/index"
import type {StorybookContractsSpecFixtureContainer} from "./contract"

export type {StorybookContractsSpecFixtureContainer} from "./contract"

throw new Error("Контейнер не исполняется при чтении")

export default function combine(input: StorybookContractsSpecFixtureContainer.Input): StorybookContractsSpecFixtureContainer.Output {
  return {total: part(input.left).value + part(input.right).value}
}
