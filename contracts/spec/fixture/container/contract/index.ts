import type {ContractFixturePart} from "../part/index"

export declare namespace ContractFixtureCombined {
  type Input = {readonly left: ContractFixturePart.Output, readonly right: ContractFixturePart.Output}
  type Output = {readonly total: number}
}
