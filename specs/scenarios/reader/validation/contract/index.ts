/** Положение объявления в исходнике проверяемого сценария. */
interface ScenarioValidationLocation {
  readonly path: string
  readonly line: number
  readonly column: number
}

export declare namespace StorybookSpecsScenariosReaderValidation {
  /**
  Структура исходника и выполненные данные, нужные правилам Archetypes.
  Исполнитель может сохранять более полный отчёт без передачи его в валидатор.

  @property source - Объявления обычного сценария и признаки их размещения.

  @property [execution] - Итоги запуска; без них проверяется исходник, а динамические правила остаются непроверенными.
  */
  export interface Input {
    readonly source: {
      readonly subject: {readonly kind: "function" | "component"; readonly module: string; readonly name: string; readonly calls: readonly {readonly location: ScenarioValidationLocation; readonly variant: ScenarioValidationLocation | null; readonly test: boolean}[]} | null
      readonly path: string
      readonly native: readonly string[]
      readonly components: readonly {readonly name: string; readonly module: string | null; readonly public: boolean | null; readonly location: ScenarioValidationLocation}[]
      readonly renders: readonly {readonly method: string; readonly arguments: number; readonly jsx: boolean; readonly location: ScenarioValidationLocation}[]
      readonly registrations: readonly {
        readonly kind: "describe" | "test"
        readonly depth: number
        readonly modifiers: readonly string[]
        readonly scope: "module" | "native" | "helper" | "indirect"
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
    readonly execution?: {
      readonly groups: readonly {readonly id: number; readonly parentId: number | null; readonly label: string; readonly parameters: unknown; readonly location: ScenarioValidationLocation}[]
      readonly calls: readonly {
        readonly module: string
        readonly name: string
        readonly groupId: number | null
        readonly test: string | null
        readonly describe: readonly string[]
        readonly location: ScenarioValidationLocation | null
      }[]
      readonly tests: readonly {
        readonly status: string
        readonly label: string
        readonly message: string | null
        readonly location: ScenarioValidationLocation
      }[]
      readonly exitCode: number
    }
  }


  /**
  Результат применения правил авторства к исходнику и одному запуску.

  @property checks - Проверенные, нарушенные и пока непроверенные правила.
  */
  export interface Output {
    readonly status: "passed" | "failed" | "incomplete"
    readonly checks: readonly {
      readonly rule: string
      readonly status: "passed" | "failed" | "not-checked"
      readonly issues: readonly {
        readonly message: string
        readonly location: Input["source"]["tests"][number]["location"] | null
      }[]
    }[]
  }
}
