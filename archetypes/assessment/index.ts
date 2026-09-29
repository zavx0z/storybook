/**
Классификация и соответствие пакета получаются из нормативных сценариев.
Package задаёт общие требования, Repo проверяет корень монорепозитория,
Domain и Component проверяют взаимоисключающие предметные границы.
Общие проверки Domain используют структуру и exports; собственный spec необязателен.
Project проверяется отдельно как композиция ссылок на независимые Repo.
Чтение не меняет исходники, режим сборки или сохранённую ревизию.

@packageDocumentation
*/
import {resolve} from "node:path"
import {assessmentDiagnostics, executeOwnedScenario, executeStandard, matchesClass} from "./src/execute"
import type {ReadAssessmentInput} from "./contract/input"
import type {ReadAssessmentOutput} from "./contract/output"

export type {ReadAssessmentInput, ReadAssessmentOutput}

/**
Выполняет стандарт последовательно; сборка использует status, не угадывая класс по файлам или имени.

@throws Отмена, техническая ошибка запуска или чтения, таймаут без завершённого отчёта.
Такие ошибки не заменяются предупреждением о структуре пакета.
*/
export async function readAssessment(input: ReadAssessmentInput): Promise<ReadAssessmentOutput> {
  const target = {...input, path: resolve(input.path)}
  const base = {...await executeStandard("package", "package/spec/scenario.spec.ts", target), applicable: true}
  const repo = await executeStandard("repo", "repo/spec/scenario.spec.ts", target)
  const reports = [base, repo]
  let classification: ReadAssessmentOutput["classification"] = null
  if (matchesClass(repo, "Repo")) {
    classification = "repo"
    reports[1] = {...repo, applicable: true}
  } else {
    const domain = await executeStandard("domain", "domain/spec/scenario.spec.ts", target)
    const component = await executeStandard("component", "component/spec/scenario.spec.ts", target)
    const domainMatches = matchesClass(domain, "Domain")
    const componentMatches = matchesClass(component, "Component")
    reports.push({...domain, applicable: domainMatches}, {...component, applicable: componentMatches})
    if (domainMatches !== componentMatches) classification = domainMatches ? "domain" : "component"
    if (classification === "component") {
      reports.push({...await executeStandard("component-lifecycle", "component/spec/lifecycle.spec.ts", target), applicable: true})
    }
  }
  const behavior = classification === "component" ? await executeOwnedScenario(target)
    : classification === "domain" ? await executeOwnedScenario(target, true) : undefined
  if (behavior) reports.push(behavior)
  const diagnostics = [...assessmentDiagnostics(reports, target.path)]
  if (classification === null) diagnostics.push({rule: "classification", status: "failed", path: target.path,
    message: "Класс Repo, Domain или Component не подтверждён однозначно; результаты проб сохранены в reports"})
  const applicable = reports.filter(item => item.applicable)
  const status = classification === null || applicable.some(item => item.status === "failed") ? "failed"
    : applicable.some(item => item.status === "incomplete") ? "incomplete" : "passed"
  return {
    classification: status === "passed" ? classification : null,
    reports, diagnostics, status,
  }
}
