import type {ContractFixturePanel} from "./contract"

export type {ContractFixturePanel} from "./contract"

throw new Error("JSX исходник не исполняется")

export default function panel(props: ContractFixturePanel.Input): ContractFixturePanel.Output {
  return (
    <article aria-label={props.title}>
      <slot name="header" />
      <slot />
    </article>
  )
}
