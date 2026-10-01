import type {Part} from "./contract"

export type {Part} from "./contract"
export default function part(input: Part.Input): Part.Output {
  return {value: input.value}
}
