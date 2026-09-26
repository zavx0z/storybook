import type {ValidateScenarioInput} from "./input"

/**
Результат применения правил авторства к исходнику и одному запуску.

@property checks - Проверенные, нарушенные и пока непроверенные правила.
*/
export interface ValidateScenarioOutput {
  readonly status: "passed" | "failed" | "incomplete"
  readonly checks: readonly {
    readonly rule: string
    readonly status: "passed" | "failed" | "not-checked"
    readonly issues: readonly {
      readonly message: string
      readonly location: ValidateScenarioInput["source"]["tests"][number]["location"] | null
    }[]
  }[]
}
