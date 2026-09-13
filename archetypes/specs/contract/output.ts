import type {ReadScenarioOutput} from "../scenarios"

/**
Данные спецификации либо null, если директория spec отсутствует.

Поле scenario содержит результат запуска сценария либо null, если файла нет.
*/
export type ReadSpecOutput = {
  readonly scenario: ReadScenarioOutput | null
} | null
