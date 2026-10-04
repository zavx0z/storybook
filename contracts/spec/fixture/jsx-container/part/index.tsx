import type {StorybookContractsSpecFixtureJsxContainerPart} from "./contract"

export type {StorybookContractsSpecFixtureJsxContainerPart} from "./contract"
export default function part(props: StorybookContractsSpecFixtureJsxContainerPart.Input): StorybookContractsSpecFixtureJsxContainerPart.Output {
  return <span>{props.text}</span>
}
