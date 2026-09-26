/**
Проверяет оформление сценария по исходнику и одному техническому запуску.
Правила авторства принадлежат Archetypes; исполнитель и полный отчёт — App.

@packageDocumentation
*/
import {basename, dirname} from "node:path"
import type {ValidateScenarioInput} from "./contract/input"
import type {ValidateScenarioOutput} from "./contract/output"

export type {ValidateScenarioInput, ValidateScenarioOutput}

/**
Применяет реализованные правила авторства к структуре и одному завершённому запуску.

@param source - Разобранные объявления сценария без исполнения пользовательского кода.
@param execution - Наблюдения одного запуска, необходимые для правил подготовки и ошибок.
@returns Каждый реализованный и ещё непроверенный пункт с честным состоянием.
*/
export function validateScenario(source: ValidateScenarioInput["source"], execution: ValidateScenarioInput["execution"]): ValidateScenarioOutput {
  const checks: ValidateScenarioOutput["checks"][number][] = []
  const location = {path: source.path, line: 1, column: 1}
  const add = (rule: string, issues: ValidateScenarioOutput["checks"][number]["issues"]) => {
    checks.push({rule, status: issues.length ? "failed" : "passed", issues})
  }
  const native = source.native.map(name => name === "it" ? "test" : name)
  add("native-api", ["describe", "test", "expect"].filter(name => !native.includes(name)).map(name => ({
    message: `Не найден именованный импорт ${name} из bun:test`, location,
  })))
  add("file-location", basename(dirname(source.path)) === "spec" && /^scenario\.spec\.tsx?$/u.test(basename(source.path)) ? [] : [{
    message: "Сценарий располагается в spec/scenario.spec.ts либо spec/scenario.spec.tsx своего владельца", location,
  }])
  add("parameterization", source.registrations.filter(item => item.kind === "describe" && item.depth === 0 && !item.modifiers.includes("each")).map(item => ({
    message: `Внешняя группа ${item.label} не использует describe.each`, location: item.location,
  })))
  add("explicit-registration", source.registrations.filter(item => item.scope === "helper").map(item => ({
    message: `Объявление ${item.label} скрыто внутри вспомогательной функции`, location: item.location,
  })))
  add("inline-description", source.assertions.filter(item => !item.inline).map(item => ({
    message: item.message === null ? "У expect отсутствует описание данных" : "Описание данных вынесено из второго аргумента expect", location: item.location,
  })))
  add("direct-execution", source.native.filter(name => name === "mock" || name === "spyOn").map(name => ({
    message: `Сценарий использует импорт ${name}`, location,
  })))
  add("skip-description", source.registrations.filter(item => item.modifiers.some(name => ["skip", "skipIf", "if"].includes(name)) && !item.remarks).map(item => ({
    message: `У пропуска ${item.label} отсутствует пояснение @remarks`, location: item.location,
  })))
  add("assertions", source.tests.filter(item => !item.todo && item.assertions === 0).map(item => ({
    message: `Обычный тест ${item.label} не содержит expect`, location: item.location,
  })))
  const variants = execution.groups.filter(group => group.parentId === null)
  const setupObserved = variants.length > 0 && variants.every(group => execution.calls.some(call => call.test === null && call.describe[0] === group.label))
  checks.push({rule: "variant-setup", status: setupObserved ? "passed" : "not-checked", issues: []})
  add("execution", execution.tests.filter(test => test.status === "failed" || test.status === "error").map(test => ({
    message: test.message ?? `Проверка ${test.label} завершилась ошибкой`, location: test.location,
  })).concat(execution.exitCode === 0 ? [] : [{message: `Bun завершился с кодом ${execution.exitCode}`, location}]))
  for (const rule of ["public-entry", "fixture-ownership", "result-dataflow", "resource-cleanup", "meaning"]) {
    checks.push({rule, status: "not-checked", issues: []})
  }
  return {
    status: checks.some(check => check.status === "failed") ? "failed" : checks.some(check => check.status === "not-checked") ? "incomplete" : "passed",
    checks,
  }
}
