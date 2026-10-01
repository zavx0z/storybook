import type {Part} from "./contract"

export type {Part} from "./contract"
export default function part(props: Part.Input): Part.Output {
  return <span>{props.text}</span>
}
