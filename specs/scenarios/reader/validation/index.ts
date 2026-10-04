/**
Проверяет оформление сценария по исходнику и одному техническому запуску.
Правила авторства принадлежат Archetypes; исполнитель и полный отчёт — читатель Specs.

@packageDocumentation
*/
import {basename, dirname} from "node:path"
import {generalParticular} from "./src/general-particular"
import {singleInvocation} from "./src/single-invocation"
import type {ArchetypesScenarioValidation} from "./contract"

export type {ArchetypesScenarioValidation} from "./contract"

/**
Применяет правила авторства к структуре и, при наличии, одному завершённому запуску.

@param source - Разобранные объявления сценария без исполнения пользовательского кода.
@param execution - Наблюдения запуска; без них динамические проверки остаются непроверенными.
@returns Каждый реализованный и ещё непроверенный пункт с честным состоянием.
*/
export default function validateScenario(source: ArchetypesScenarioValidation.Input["source"], execution?: ArchetypesScenarioValidation.Input["execution"]): ArchetypesScenarioValidation.Output {
  const checks: ArchetypesScenarioValidation.Output["checks"][number][] = []
  const location = {path: source.path, line: 1, column: 1}
  const add = (rule: string, issues: ArchetypesScenarioValidation.Output["checks"][number]["issues"]) => {
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
  add("render-jsx", (source.subject?.kind === "function" ? [] : source.renders).filter(render => render.method !== "render" || render.arguments !== 1 || !render.jsx).map(render => ({
    message: "В сценарии render принимает ровно один аргумент: JSX компонента с props непосредственно в месте вызова.",
    location: render.location,
  })))
  const componentIssues = source.components.filter(component => component.public === false).map(component => ({
    message: `JSX-компонент ${component.name} должен импортироваться из публичного входа. Локальная обёртка или частная фикстура скрывает композицию сценария; разместите JSX непосредственно в render или slots варианта.`,
    location: component.location,
  }))
  checks.push({rule: "component-origin", status: componentIssues.length ? "failed"
    : source.components.some(component => component.public === null) ? "not-checked" : "passed", issues: componentIssues})
  add("direct-execution", source.native.filter(name => name === "mock.module" || name === "spyOn").map(name => ({
    message: `Сценарий выполняет публичную сущность напрямую; ${name} подменяет существующую реализацию. mock() применяется к передаваемому callback`, location,
  })))
  add("skip-description", source.registrations.filter(item => item.modifiers.some(name => ["skip", "skipIf", "if"].includes(name)) && !item.remarks).map(item => ({
    message: `У пропуска ${item.label} отсутствует пояснение @remarks`, location: item.location,
  })))
  add("assertions", source.tests.filter(item => !item.todo && item.assertions === 0).map(item => ({
    message: `Обычный тест ${item.label} не содержит expect`, location: item.location,
  })))
  checks.push(generalParticular(source), singleInvocation(source, execution))
  if (execution) {
    const variants = execution.groups.filter(group => group.parentId === null)
    const setupObserved = variants.length > 0 && variants.every(group => execution.calls.some(call => call.test === null && call.describe[0] === group.label))
    checks.push({rule: "variant-setup", status: setupObserved ? "passed" : "not-checked", issues: []})
    add("execution", execution.tests.filter(test => test.status === "failed" || test.status === "error").map(test => ({
      message: test.message ?? `Проверка ${test.label} завершилась ошибкой`, location: test.location,
    })).concat(execution.exitCode === 0 ? [] : [{message: `Bun завершился с кодом ${execution.exitCode}`, location}]))
  } else {
    checks.push({rule: "variant-setup", status: "not-checked", issues: []}, {rule: "execution", status: "not-checked", issues: []})
  }
  for (const rule of ["public-entry", "fixture-ownership", "result-dataflow", "resource-cleanup", "meaning"]) {
    checks.push({rule, status: "not-checked", issues: []})
  }
  return {
    status: checks.some(check => check.status === "failed") ? "failed" : checks.some(check => check.status === "not-checked") ? "incomplete" : "passed",
    checks,
  }
}
