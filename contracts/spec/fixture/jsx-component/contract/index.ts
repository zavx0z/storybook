import type {JSX} from "@zavx0z/jsx"

export declare namespace Panel {
  type Input = {readonly title: string}
  type Slots = {
    readonly default: JSX.Element
    readonly header?: JSX.Element
  }
  type Output = JSX.Element<Slots>
}
