import type {Counter} from "./counter"

/** Протокол изменения значения счётчика на сервере. */
export declare namespace StorybookDomainSpecFixtureDomain {
  interface Input {
    readonly counter: Counter
    readonly step: number
  }
  type Output = Counter
}
