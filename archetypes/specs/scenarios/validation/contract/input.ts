/** Положение объявления в исходнике проверяемого сценария. */
interface ScenarioValidationLocation {
  readonly path: string
  readonly line: number
  readonly column: number
}

/**
Структура исходника и выполненные данные, нужные правилам Archetypes.
Исполнитель может сохранять более полный отчёт без передачи его в валидатор.

@property source - Объявления обычного сценария и признаки их размещения.

@property execution - Итоги одного запуска для проверки подготовки и ошибок.
*/
export interface ValidateScenarioInput {
  readonly source: {
    readonly path: string
    readonly native: readonly string[]
    readonly registrations: readonly {
      readonly kind: "describe" | "test"
      readonly depth: number
      readonly modifiers: readonly string[]
      readonly scope: "module" | "native" | "helper"
      readonly label: string
      readonly location: ScenarioValidationLocation
      readonly remarks: string | null
    }[]
    readonly assertions: readonly {
      readonly inline: boolean
      readonly message: string | null
      readonly location: ScenarioValidationLocation
    }[]
    readonly tests: readonly {
      readonly todo: boolean
      readonly assertions: number
      readonly label: string
      readonly location: ScenarioValidationLocation
    }[]
  }
  readonly execution: {
    readonly groups: readonly {readonly parentId: number | null; readonly label: string}[]
    readonly calls: readonly {readonly test: string | null; readonly describe: readonly string[]}[]
    readonly tests: readonly {
      readonly status: string
      readonly label: string
      readonly message: string | null
      readonly location: ScenarioValidationLocation
    }[]
    readonly exitCode: number
  }
}
