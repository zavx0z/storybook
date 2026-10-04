/**
Читает, выполняет и проверяет сценарий.

Возвращает структуру исходника, данные выполнения и результаты валидации.

@packageDocumentation
*/
import {traceScenario} from "./src/trace"
import {validateRunProps} from "./src/run-props"
import {readScenarioSource} from "./src/read-source"
import validateScenario from "@zavx0z/storybook-specs-scenarios-reader-validation"
import {createScenarioPreview, supportsScenarioPreview} from "./src/preview"
import {ScenarioAuthoringError} from "./src/authoring-error"
import type {StorybookSpecsScenariosReader} from "./contract"

export type {StorybookSpecsScenariosReader} from "./contract"

/**
Получает структуру исходника, выполняет его настоящим Bun Test и применяет правила архетипа.

@param input - Путь к сценарию и необязательные именованные props;
среда запуска определяется из его пакета.

@returns Структура исходника, данные одного запуска и отчёт валидации.
Нарушения оформления и выполненных проверок возвращаются в validation;
нереализованные проверки не считаются пройденными.
@throws Ошибка запуска, таймаут или отсутствие завершающего отчёта.
*/
async function readScenario(input: StorybookSpecsScenariosReader.Input): Promise<StorybookSpecsScenariosReader.Output> {
  input.signal?.throwIfAborted()
  const onProgress: NonNullable<StorybookSpecsScenariosReader.Input["onProgress"]> = progress => {
    try { input.onProgress?.(progress) } catch { /* Наблюдение не влияет на результат теста. */ }
  }
  onProgress({phase: "preparing"})
  if (input.variant !== undefined && (!Number.isSafeInteger(input.variant) || input.variant < 0)) {
    throw new TypeError("variant должен быть неотрицательным индексом строки")
  }
  if (input.variantPath !== undefined && (input.variant !== undefined || !Array.isArray(input.variantPath)
    || input.variantPath.length === 0 || input.variantPath.some(index => !Number.isSafeInteger(index) || index < 0))) {
    throw new TypeError("variantPath должен содержать неотрицательные индексы и не совмещаться с variant")
  }
  if (input.props !== undefined) validateRunProps(input.props)
  const source = await readScenarioSource(input.path)
  const outerGroups = source.groups.filter(group => group.depth === 0)
  if ((input.variant !== undefined || input.variantPath !== undefined) && (outerGroups.length !== 1 || !outerGroups[0]!.each)) {
    throw new Error("Выбор варианта требует единственного внешнего describe.each")
  }
  const execution = await traceScenario({...input, path: source.path, onProgress})
  onProgress({phase: "reporting"})
  const validation = validateScenario(source, execution)
  const preview = validation.checks.some(check => ["render-jsx", "component-origin", "single-invocation", "general-particular"].includes(check.rule) && check.status === "failed") ? undefined : await createScenarioPreview(source.path, execution, Object.keys(input.props ?? {}), input.variant ?? 0, input.variantPath ?? (input.variant === undefined ? undefined : [input.variant]))
  return {
    ...execution,
    source,
    validation,
    ...(preview === undefined ? {} : {preview}),
  }
}

/** Читает сценарий и предоставляет статическую проверку поддержки preview того же формата. */
export default Object.assign(readScenario, {
  supportsPreview: supportsScenarioPreview,
  isAuthoringError(error: unknown): error is Error & {readonly checks: StorybookSpecsScenariosReader.Output["validation"]["checks"]} {
    return error instanceof ScenarioAuthoringError
  },
})
