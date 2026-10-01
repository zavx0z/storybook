import type {JSX} from "@zavx0z/jsx"
import type {ContractFixturePart} from "../part/index"

export declare namespace ContractFixtureWorkspace {
  type Input = {readonly title: string, readonly content: ContractFixturePart.Input}
  type Slots = {
    readonly default: JSX.Element
    readonly header?: JSX.Element
  }
  type Output = JSX.Element<Slots>
}
