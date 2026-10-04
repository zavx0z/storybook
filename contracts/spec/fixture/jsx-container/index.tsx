import StorybookContractsSpecFixtureJsxContainerPart from "./part/index"
import type {StorybookContractsSpecFixtureJsxContainer} from "./contract"

export type {StorybookContractsSpecFixtureJsxContainer} from "./contract"

throw new Error("JSX контейнер не исполняется")

export default function workspace(props: StorybookContractsSpecFixtureJsxContainer.Input): StorybookContractsSpecFixtureJsxContainer.Output {
  return (
    <article aria-label={props.title}>
      <slot name="header" />
      <StorybookContractsSpecFixtureJsxContainerPart text={props.content.text} />
      <slot />
    </article>
  )
}
