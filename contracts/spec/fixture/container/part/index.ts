import type {ContractFixturePart} from "./contract"

export type {ContractFixturePart} from "./contract"
export default function part(input: ContractFixturePart.Input): ContractFixturePart.Output {
  return {value: input.value}
}
