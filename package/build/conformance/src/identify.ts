import {resolve} from "node:path"
import type {StorybookPackageBuildConformance} from "../contract"

type Report = Parameters<StorybookPackageBuildConformance.Output["identify"]>[0]
type Result = ReturnType<StorybookPackageBuildConformance.Output["identify"]>
const types = ["Repo", "Component", "Container", "Cluster", "Domain"] as const

/**
Интерпретирует подтверждённую карту кандидатов уже выполненного нормативного сценария.
Не повторяет его условия классификации по исходникам, exports или вложенности.
Выполненные проверки проходят без ошибок; TODO сохраняются и не блокируют
выбор единственного кандидата с выполненными применимыми проверками.
Сохранённые отчёты прежнего сценария распознаются по его исходной форме;
отсутствующая карта нового сценария не становится старым отчётом.
*/
export function identifyType(
  report: Report,
  owner: string,
  scenario: string,
  verify: StorybookPackageBuildConformance.Output["verify"],
): Result {
  if (report === null || typeof report !== "object" || report.path !== scenario
    || !Array.isArray(report.groups) || !Array.isArray(report.tests) || !Array.isArray(report.assertions)) {
    return {status: "unknown", reason: "invalid-report"}
  }
  const roots = report.groups.filter(group => group.parentId === null)
  if (roots.length !== 1 || roots[0]!.mode !== "run") return {status: "unknown", reason: "invalid-report"}
  const parameters = roots[0]!.parameters
  const props = parameters !== null && typeof parameters === "object" && !Array.isArray(parameters) ? parameters.props : undefined
  const path = props !== null && typeof props === "object" && !Array.isArray(props) ? props.path : undefined
  if (typeof path !== "string" || resolve(path) !== owner) return {status: "unknown", reason: "invalid-report"}
  if (report.exitCode !== 0) return {status: "unknown", reason: "failed"}
  try {
    const verification = verify(report)
    if (verification.status !== "passed") return {status: "unknown", reason: verification.status === "failed" ? "failed" : "incomplete"}
  } catch {
    return {status: "unknown", reason: "invalid-report"}
  }
  const groups = report.groups.filter(group => group.parentId === roots[0]!.id && types.some(type => type === group.label))
  if (groups.length !== types.length || types.some(type => groups.filter(group => group.label === type).length !== 1)) {
    return {status: "unknown", reason: "invalid-report"}
  }
  const snapshot = report.source?.text
  const legacy = typeof snapshot === "string" && !/expect\(\s*\{\s*complete\s*:/u.test(snapshot)
    && types.every(type => new RegExp(`describe\\.skipIf\\(\\s*!${type.toLowerCase()}\\s*\\)\\(\\s*["']${type}["']`, "u").test(snapshot))
    && snapshot.includes("Number(repo) + Number(domain) + Number(cluster) + Number(component) + Number(container) === 1")
  if (legacy) {
    const selected = groups.filter(group => group.mode === "run")
    if (selected.length !== 1 || groups.some(group => group.mode === "todo")) return {status: "unknown", reason: "ambiguous"}
    const tests = report.tests.filter(test => test.groupId === selected[0]!.id)
    if (!tests.some(test => test.status === "passed") || tests.some(test => test.status !== "passed" && test.status !== "todo")) {
      return {status: "unknown", reason: "incomplete"}
    }
    return {status: "confirmed", type: types.find(type => type === selected[0]!.label)!}
  }
  const classification = report.groups.filter(group => group.parentId === roots[0]!.id && group.label === "Классификация")
  if (classification.length !== 1) return {status: "unknown", reason: "invalid-report"}
  const points = report.tests.filter(test => test.groupId === classification[0]!.id && test.label === "Структурная роль")
  if (points.length !== 1) return {status: "unknown", reason: "invalid-report"}
  if (classification[0]!.mode !== "run" || points[0]!.status !== "passed") return {status: "unknown", reason: "incomplete"}
  const assertions = report.assertions.filter(assertion => assertion.testId === points[0]!.id)
  if (assertions.length !== 1 || assertions[0]!.status !== "passed") return {status: "unknown", reason: "invalid-report"}
  const facts = assertions[0]!.actual
  if (facts === null || typeof facts !== "object" || Array.isArray(facts)
    || typeof facts.complete !== "boolean" || facts.roles === null || typeof facts.roles !== "object" || Array.isArray(facts.roles)) {
    return {status: "unknown", reason: "invalid-report"}
  }
  const roles = facts.roles as Readonly<Record<string, unknown>>
  if (Object.keys(facts).length !== 2 || Object.keys(roles).length !== types.length
    || types.some(type => typeof roles[type] !== "boolean")) return {status: "unknown", reason: "invalid-report"}
  if (!facts.complete) return {status: "unknown", reason: "incomplete"}
  const selected = types.filter(type => roles[type])
  if (selected.length !== 1) return {status: "unknown", reason: "ambiguous"}
  if (groups.some(group => group.mode !== "run")) return {status: "unknown", reason: "incomplete"}
  const tests = report.tests.filter(test => test.groupId === groups.find(group => group.label === selected[0])!.id)
  if (!tests.some(test => test.status === "passed") || tests.some(test => test.status !== "passed" && test.status !== "todo")) {
    return {status: "unknown", reason: "incomplete"}
  }
  for (const test of tests.filter(test => test.status === "passed")) {
    const evidence = report.assertions.filter(assertion => assertion.testId === test.id)
    if (!evidence.length || evidence.some(assertion => assertion.status !== "passed" || assertion.actual === null
      || typeof assertion.actual !== "object" || Array.isArray(assertion.actual) || assertion.actual.applicable !== true)) {
      return {status: "unknown", reason: "invalid-report"}
    }
  }
  return {status: "confirmed", type: selected[0]!}
}
