import part from "./part/index"
import type {ContractFixtureCombined} from "./contract"

export type {ContractFixtureCombined} from "./contract"

throw new Error("Контейнер не исполняется при чтении")

export default function combine(input: ContractFixtureCombined.Input): ContractFixtureCombined.Output {
  return {total: part(input.left).value + part(input.right).value}
}
