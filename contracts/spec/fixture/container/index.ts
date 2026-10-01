import part from "./part/index"
import type {Combined} from "./contract"

export type {Combined} from "./contract"

throw new Error("Контейнер не исполняется при чтении")

export default function combine(input: Combined.Input): Combined.Output {
  return {total: part(input.left).value + part(input.right).value}
}
