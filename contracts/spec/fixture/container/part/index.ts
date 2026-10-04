import type {StorybookContractsSpecFixtureContainerPart} from "./contract"

export type {StorybookContractsSpecFixtureContainerPart} from "./contract"
export default function part(input: StorybookContractsSpecFixtureContainerPart.Input): StorybookContractsSpecFixtureContainerPart.Output {
  return {value: input.value}
}
