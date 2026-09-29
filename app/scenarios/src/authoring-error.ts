import type {ReadScenarioOutput} from "../contract/output"

/** Нарушение авторского стандарта, из-за которого нельзя однозначно подготовить preview. */
export class ScenarioAuthoringError extends Error {
  constructor(readonly checks: ReadScenarioOutput["validation"]["checks"]) {
    super(checks.flatMap(check => check.issues.map(issue =>
      `${issue.location?.path ?? "scenario"}:${issue.location?.line ?? 1}: [${check.rule}] ${issue.message}`,
    )).join("\n"))
    this.name = "ScenarioAuthoringError"
  }
}
