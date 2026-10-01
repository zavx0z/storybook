import Part from "./part/index"
import type {Workspace} from "./contract"

export type {Workspace} from "./contract"

throw new Error("JSX контейнер не исполняется")

export default function workspace(props: Workspace.Input): Workspace.Output {
  return (
    <article aria-label={props.title}>
      <slot name="header" />
      <Part text={props.content.text} />
      <slot />
    </article>
  )
}
