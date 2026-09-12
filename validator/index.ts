/**
Применяет существующие спецификации к выбранному пути.
Правила и примеры остаются в Archetypes; валидатор отвечает за запуск и отчёт.

@packageDocumentation
*/
import {runTests} from "./src/run-tests.ts"
import {transformReport} from "./src/transform-report.ts"
import type {ValidationInput} from "./contract/input.ts"
import type {ValidationOutput} from "./contract/output.ts"

export type {ValidationInput} from "./contract/input.ts"
export type {ValidationOutput} from "./contract/output.ts"

/**
Последовательно запускает Bun и преобразует его результат.

@param input - Путь объекта, существующая спецификация и параметры запуска.
@returns Статусы проверок, диагностические сообщения и полный исходный вывод.
*/
export async function validate(input: ValidationInput): Promise<ValidationOutput> {
  const raw = await runTests(input)
  return transformReport(raw)
}
