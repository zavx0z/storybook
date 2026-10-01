import ContractFixturePart from "./part/index"
import type {ContractFixtureWorkspace} from "./contract"

export type {ContractFixtureWorkspace} from "./contract"

throw new Error("JSX контейнер не исполняется")

export default function workspace(props: ContractFixtureWorkspace.Input): ContractFixtureWorkspace.Output {
  return (
    <article aria-label={props.title}>
      <slot name="header" />
      <ContractFixturePart text={props.content.text} />
      <slot />
    </article>
  )
}
