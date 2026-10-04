import type {StorybookContractsSpecFixtureJsxComponent} from "./contract"

export type {StorybookContractsSpecFixtureJsxComponent} from "./contract"

throw new Error("JSX исходник не исполняется")

export default function panel(props: StorybookContractsSpecFixtureJsxComponent.Input): StorybookContractsSpecFixtureJsxComponent.Output {
  return (
    <article aria-label={props.title}>
      <slot name="header" />
      <slot />
    </article>
  )
}
