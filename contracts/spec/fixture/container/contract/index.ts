import type {Part} from "../part/index"

export declare namespace Combined {
  type Input = {readonly left: Part.Output, readonly right: Part.Output}
  type Output = {readonly total: number}
}
