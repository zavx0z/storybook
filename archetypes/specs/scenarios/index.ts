/**
Исполняет сценарий настоящим Bun Test.

Возвращает наблюдаемые вызовы функций и методов с контекстом сценария через trace.

@packageDocumentation
*/
import {traceScenario} from "./src/trace"
import type {ReadScenarioInput} from "./contract/input"
import type {ReadScenarioOutput} from "./contract/output"

export type {ReadScenarioInput, ReadScenarioOutput}

/**
Запускает настоящий Bun Test и возвращает вызовы выбранных функций и методов.

@param input - Путь к сценарию; среда запуска определяется из его пакета.

@returns Аргументы, исходы вызовов и их принадлежность группам и тестам.
@throws Ошибка запуска, таймаут или отсутствие завершающего отчёта.
*/
export async function readScenario(input: ReadScenarioInput): Promise<ReadScenarioOutput> {
  return traceScenario(input)
}
