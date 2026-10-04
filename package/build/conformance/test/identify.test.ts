import {expect, test} from "bun:test"
import {readFileSync} from "node:fs"
import {resolve} from "node:path"
import conformance, {type StorybookPackageBuildConformance} from "@zavx0z/storybook-package-build-conformance"

type Report = Parameters<StorybookPackageBuildConformance.Output["identify"]>[0]
const owner = "/fixture/owner"
const scenario = resolve(import.meta.dir, "../../../reader/spec/scenario.spec.ts")
const types = ["Repo", "Component", "Container", "Cluster", "Domain"] as const

/** Модель native отчёта: все общие проверки выполнены, неприменимые группы явно пропущены. */
function report(type: typeof types[number]): Report {
  const groups = [
    {id: 0, parentId: null, label: "Архетип пакета", mode: "run", parameters: {props: {path: owner}}},
    ...types.map((label, index) => ({id: index + 1, parentId: 0, label, mode: label === type ? "run" : "skip"})),
    {id: 6, parentId: 0, label: "Общие требования", mode: "run"},
  ]
  return {
    path: scenario,
    source: {text: readFileSync(scenario, "utf8")},
    exitCode: 0,
    stderr: "",
    groups,
    tests: groups.slice(1).map(group => ({id: group.id, groupId: group.id, label: "Проверка", status: group.mode === "run" ? "passed" : "skipped",
      skipReason: group.mode === "skip" ? "Другой архетип" : null, location: {path: scenario}})),
    assertions: [],
    validation: {checks: []},
  } as unknown as Report
}

test.each([...types])("полный отчёт с одной применимой группой подтверждает %s", type => {
  expect(conformance.identify(report(type), owner)).toEqual({status: "confirmed", type})
})

test.each(["not-executed", "skipped"] as const)("общая незавершённость %s не подтверждает тип", status => {
  const value = report("Component")
  const tests = value.tests.map(test => test.id === 6 ? {...test, status, skipReason: null} : test)
  expect(conformance.identify({...value, tests}, owner)).toEqual({status: "unknown", reason: "incomplete"})
})

test("общий провал не скрывается за успешной группой Component", () => {
  const value = report("Component")
  expect(conformance.identify({...value, exitCode: 1}, owner)).toEqual({status: "unknown", reason: "failed"})
})

test("неоднозначность применимых групп не разрешается приоритетом имён", () => {
  const value = report("Component")
  const groups = value.groups.map(group => group.label === "Container" ? {...group, mode: "run" as const} : group)
  expect(conformance.identify({...value, groups}, owner)).toEqual({status: "unknown", reason: "ambiguous"})
})

test("отсутствие применимой группы не назначает Component по умолчанию", () => {
  const value = report("Component")
  const groups = value.groups.map(group => group.label === "Component" ? {...group, mode: "skip" as const} : group)
  expect(conformance.identify({...value, groups}, owner)).toEqual({status: "unknown", reason: "ambiguous"})
})

test("чужой владелец, другой сценарий и неполный состав групп отвергаются", () => {
  const value = report("Component")
  expect(conformance.identify(value, "/fixture/other")).toEqual({status: "unknown", reason: "invalid-report"})
  expect(conformance.identify({...value, path: "/other/scenario.spec.ts"}, owner)).toEqual({status: "unknown", reason: "invalid-report"})
  expect(conformance.identify({...value, groups: value.groups.filter(group => group.label !== "Repo")}, owner))
    .toEqual({status: "unknown", reason: "invalid-report"})
})

test("сохранённая редакция сценария не обязана совпадать с текущими исходниками", () => {
  const value = report("Component")
  expect(conformance.identify({...value, source: {...value.source, text: "previous rules"}}, owner))
    .toEqual({status: "confirmed", type: "Component"})
})

test("провал проверки правил авторства не подтверждает тип", () => {
  const value = report("Component")
  const validation = {...value.validation, checks: [{rule: "single-invocation", status: "failed", issues: []}]} as Report["validation"]
  expect(conformance.identify({...value, validation}, owner)).toEqual({status: "unknown", reason: "failed"})
})


test("TODO не отменяет подтверждение выполненной группы", () => {
  const value = report("Component")
  const tests = value.tests.map(test => test.id === 6 ? {...test, status: "todo" as const} : test)
  expect(conformance.identify({...value, tests}, owner)).toEqual({status: "confirmed", type: "Component"})
  expect(tests.find(test => test.id === 6)!.status).toBe("todo")
})
