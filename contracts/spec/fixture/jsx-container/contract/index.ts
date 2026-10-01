import type {JSX} from "@zavx0z/jsx"
import type {Part} from "../part/index"
import type {Regions} from "./regions"

export declare namespace Workspace {
  type Input = {readonly title: string, readonly content: Part.Input}
  type Slots = Regions
  type Output = JSX.Element<Slots>
}
