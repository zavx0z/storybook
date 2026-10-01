import type {ContractFixturePart} from "./contract"

export type {ContractFixturePart} from "./contract"
export default function part(props: ContractFixturePart.Input): ContractFixturePart.Output {
  return <span>{props.text}</span>
}
