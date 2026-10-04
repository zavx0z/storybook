import {resolve} from "node:path"
import type {StorybookPackageBuildConformance} from "../contract"

type Report = Parameters<StorybookPackageBuildConformance.Output["identify"]>[0]
type Result = ReturnType<StorybookPackageBuildConformance.Output["identify"]>
const types = ["Repo", "Component", "Container", "Cluster", "Domain"] as const

/**
Интерпретирует применимость групп уже выполненного нормативного сценария.
Не повторяет его условия классификации по исходникам, exports или вложенности.
Выполненные проверки проходят без ошибок; TODO сохраняются и не блокируют
выбор единственной применимой группы с выполненными проверками.
*/
export function identifyType(
  report: Report,
  owner: string,
  scenario: string,
  verify: StorybookPackageBuildConformance.Output["verify"],
): Result {
  if (report === null || typeof report !== "object" || report.path !== scenario
    || !Array.isArray(report.groups) || !Array.isArray(report.tests)) {
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
  const selected = groups.filter(group => group.mode === "run")
  if (selected.length !== 1 || groups.some(group => group.mode === "todo")) return {status: "unknown", reason: "ambiguous"}
  if (!report.tests.some(test => test.groupId === selected[0]!.id && test.status === "passed")) {
    return {status: "unknown", reason: "incomplete"}
  }
  return {status: "confirmed", type: types.find(type => type === selected[0]!.label)!}
}
