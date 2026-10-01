import type {JSX} from "@zavx0z/jsx"
import type {Regions} from "./regions"

export declare namespace Panel {
  type Input = {readonly title: string}
  type Slots = Regions
  type Output = JSX.Element<Slots>
}
