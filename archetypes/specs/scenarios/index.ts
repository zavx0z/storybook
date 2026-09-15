/**
Исполняет сценарий настоящим Bun Test.

Возвращает группы, тесты, утверждения, наблюдаемые вызовы и исходный отчёт runner.

@packageDocumentation
*/
import {traceScenario} from "./src/trace"
import type {ReadScenarioInput} from "./contract/input"
import type {ReadScenarioOutput} from "./contract/output"

export type {ReadScenarioInput, ReadScenarioOutput}

/**
Запускает настоящий Bun Test и собирает данные его выполнения.

@param input - Путь к сценарию; среда запуска определяется из его пакета.

@returns Группы, пункты, expect с фактическими значениями, вызовы с контекстом,
код завершения, stdout, stderr и исходный JUnit одного запуска.
@throws Ошибка запуска, таймаут или отсутствие завершающего отчёта.
*/
export async function readScenario(input: ReadScenarioInput): Promise<ReadScenarioOutput> {
  return traceScenario(input)
}
