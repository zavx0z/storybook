import {dirname, join, relative} from "node:path"
import {lstat} from "node:fs/promises"
import type {ReadScenarioOutput} from "@storybook/app/scenarios"
import type {ReadScenarioGuideOutput} from "../scenarios/contract/output"

/** Собирает руководство из прочитанного App сценария и реально существующих файлов его владельца. */
export async function createScenarioGuide(report: ReadScenarioOutput): Promise<ReadScenarioGuideOutput> {
  const owner = dirname(dirname(report.path))
  const files: ReadScenarioGuideOutput["files"][number][] = [
    {path: relative(owner, report.path), role: "scenario"},
  ]
  for (const [candidates, role] of [
    [["index.tsx", "index.ts"], "public-entry"],
    [["contract/input.ts"], "contract"],
    [["contract/output.ts"], "contract"],
    [["spec/fixture/index.tsx", "spec/fixture/index.ts"], "fixture"],
  ] as const) {
    for (const path of candidates) {
      const info = await lstat(join(owner, path)).catch(error => {
        if (error.code !== "ENOENT") throw error
        return null
      })
      if (!info?.isFile() || info.isSymbolicLink()) continue
      files.push({path, role})
      break
    }
  }
  const condition = report.source.registrations.find(item => item.kind === "describe" && item.modifiers.includes("skipIf"))
  const conditional = condition && report.source.groups.find(group => group.location.line === condition.location.line && group.location.column === condition.location.column)
  const examples = [
    {title: "Сценарий целиком", code: report.source.text},
    ...report.source.groups.filter(group => group.depth === 0).flatMap(group => [
      {title: "Вариант использования", code: group.header},
      ...(group.setup.trim() ? [{title: "Подготовка варианта", code: group.setup}] : []),
    ]),
    ...report.source.groups.filter(group => group.depth > 0).map(group => ({title: "Категория", code: group.source})),
    ...(conditional ? [{title: "Условный пропуск", code: conditional.source}] : []),
    ...[
      {title: "Пункт сценария", test: report.source.tests.find(test => !test.todo && !test.each && !test.skippable)},
      {title: "Проверка callback", test: report.source.tests.find(test => test.source.includes(".mock.calls"))},
      {title: "Связанные утверждения", test: report.source.tests.find(test => test.assertions > 1)},
      {title: "Параметризация пунктов", test: report.source.tests.find(test => test.each)},
      {title: "Условный пропуск", test: conditional ? undefined : report.source.tests.find(test => test.skippable)},
      {title: "Незавершённый пункт", test: report.source.tests.find(test => test.todo)},
    ].flatMap(({title, test}) => test ? [{title, code: test.source}] : []),
    ...report.source.checks.filter(check => check.matcher === "toEqual" && check.explicitObject).slice(0, 1)
      .map(check => ({title: "Состав объекта", code: check.source})),
    ...report.source.hooks.map(hook => ({
      title: `${hook.name.startsWith("after") ? "Освобождение" : "Подготовка"} ресурсов: ${hook.name}`,
      code: hook.source,
    })),
  ]
  return {
    kind: "scenario-guide",
    files,
    examples,
    checks: report.validation.checks.map(check => ({
      rule: check.rule,
      status: check.status,
      issues: check.issues.map(issue => issue.message),
    })),
  }
}
