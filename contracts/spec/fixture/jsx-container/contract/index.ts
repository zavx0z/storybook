import type {JSX} from "@zavx0z/jsx"
import type {Part} from "../part/index"

export declare namespace Workspace {
  type Input = {readonly title: string, readonly content: Part.Input}
  type Slots = {
    readonly default: JSX.Element
    readonly header?: JSX.Element
  }
  type Output = JSX.Element<Slots>
}
