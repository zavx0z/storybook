import type {ReadScenarioOutput} from "@storybook/app/scenarios"

/**
Свидетельства применения нормативных сценариев к пакету.

@property status - passed только при полном прохождении всех применимых нормативных suites.
TODO, непроверенные пункты и недокументированные пропуски сохраняют incomplete.
@property classification - Класс, подтверждённый нормативной пробой и полным набором
применимых проверок. При failed/incomplete равен null; кандидат виден в reports.
Domain и Component взаимоисключающи.
@property reports - Полные результаты; отрицательная проба неприменимого класса не является нарушением пакета.
message объясняет отсутствие применимого сценария. Технический сбой чтения, запуска
или таймаут выбрасывается и не подменяется отчётом о соответствии.
@property diagnostics - Нарушения и незавершённые пункты применимых проверок. Решение о блокировке принадлежит сборке.
*/
export interface ReadAssessmentOutput {
  readonly status: "passed" | "failed" | "incomplete"
  readonly classification: "repo" | "domain" | "component" | null
  readonly reports: readonly {
    readonly archetype: string
    readonly applicable: boolean
    readonly status: "passed" | "failed" | "incomplete"
    readonly report?: ReadScenarioOutput
    readonly message?: string
  }[]
  readonly diagnostics: readonly {
    readonly rule: string
    readonly status: "failed" | "not-checked"
    readonly message: string
    readonly path: string
  }[]
}
