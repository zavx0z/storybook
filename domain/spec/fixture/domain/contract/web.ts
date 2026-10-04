import type {Counter} from "./counter"

/** Протокол текстового представления счётчика. */
export declare namespace StorybookDomainSpecFixtureDomain {
  interface Input {
    readonly counter: Counter
    readonly prefix?: string
  }
  type Output = string
}
