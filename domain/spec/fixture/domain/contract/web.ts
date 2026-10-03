import type {Counter} from "./counter"

/** Протокол текстового представления счётчика. */
export declare namespace FixtureArchetypeDomain {
  interface Input {
    readonly counter: Counter
    readonly prefix?: string
  }
  type Output = string
}
