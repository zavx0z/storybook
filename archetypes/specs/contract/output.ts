import type {ReadScenarioOutput} from "../scenarios"

/**
Прочитанная спецификация либо `null`, если директория `spec` отсутствует.

@property scenario - Результат запуска сценария {@link ReadScenarioOutput}
либо `null`, если в спецификации нет файла сценария.
*/
export type ReadSpecOutput = {
  readonly scenario: ReadScenarioOutput | null
} | null
