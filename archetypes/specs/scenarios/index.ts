/**
Читает, выполняет и проверяет сценарий.

Возвращает структуру исходника, данные выполнения и результаты валидации.

@packageDocumentation
*/
import {traceScenario} from "./src/trace"
import {validateRunProps} from "./src/run-props"
import {readScenarioSource} from "./src/read-source"
import {validateScenario} from "./src/validate"
import {createScenarioPreview, supportsScenarioPreview} from "./src/preview"
import type {ReadScenarioInput} from "./contract/input"
import type {ReadScenarioOutput} from "./contract/output"
import type {ScenarioPreview} from "./src/types"

export type {ReadScenarioInput, ReadScenarioOutput, ScenarioPreview}
export {supportsScenarioPreview}

/**
Получает структуру исходника, выполняет его настоящим Bun Test и применяет правила архетипа.

@param input - Путь к сценарию и необязательные именованные props;
среда запуска определяется из его пакета.

@returns Структура исходника, данные одного запуска и отчёт валидации.
Нарушения оформления и выполненных проверок возвращаются в validation;
нереализованные проверки не считаются пройденными.
@throws Ошибка запуска, таймаут или отсутствие завершающего отчёта.
*/
export async function readScenario(input: ReadScenarioInput): Promise<ReadScenarioOutput> {
  if (input.props !== undefined) validateRunProps(input.props)
  const source = await readScenarioSource(input.path)
  const execution = await traceScenario({...input, path: source.path})
  const preview = await createScenarioPreview(source.path, execution, Object.keys(input.props ?? {}))
  return {
    ...execution,
    source,
    validation: validateScenario(source, execution),
    ...(preview === undefined ? {} : {preview}),
  }
}
