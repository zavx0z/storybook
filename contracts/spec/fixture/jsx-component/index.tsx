import type {Panel} from "./contract"

export type {Panel} from "./contract"

throw new Error("JSX исходник не исполняется")

export default function panel(props: Panel.Input): Panel.Output {
  return (
    <article aria-label={props.title}>
      <slot name="header" />
      <slot />
    </article>
  )
}
