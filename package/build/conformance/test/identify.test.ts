import {expect, test} from "bun:test"
import {readFileSync} from "node:fs"
import {resolve} from "node:path"
import conformance, {type StorybookPackageBuildConformance} from "@zavx0z/storybook-package-build-conformance"

type Report = Parameters<StorybookPackageBuildConformance.Output["identify"]>[0]
const owner = "/fixture/owner"
const scenario = resolve(import.meta.dir, "../../../reader/spec/scenario.spec.ts")
const types = ["Repo", "Component", "Container", "Cluster", "Domain"] as const

/** Модель нового native отчёта: применимость раскрыта в actual, все темы зарегистрированы. */
function report(type: typeof types[number]): Report {
  const groups = [
    {id: 0, parentId: null, label: "Архетип пакета", mode: "run", parameters: {props: {path: owner}}},
    ...types.map((label, index) => ({id: index + 1, parentId: 0, label, mode: "run"})),
    {id: 6, parentId: 0, label: "Общие требования", mode: "run"},
    {id: 7, parentId: 0, label: "Классификация", mode: "run"},
  ]
  return {
    path: scenario,
    source: {text: readFileSync(scenario, "utf8")},
    exitCode: 0,
    stderr: "",
    groups,
    tests: groups.slice(1).map(group => ({id: group.id, groupId: group.id, label: group.id === 7 ? "Структурная роль" : "Проверка", status: "passed",
      skipReason: null, location: {path: scenario}})),
    assertions: [
      ...types.map((label, index) => ({testId: index + 1, status: "passed", actual: {applicable: label === type, value: []}})),
      {testId: 7, status: "passed", actual: {complete: true, roles: Object.fromEntries(types.map(label => [label, label === type]))}},
    ],
    validation: {checks: []},
  } as unknown as Report
}

test.each([...types])("полный отчёт с одним подтверждённым кандидатом подтверждает %s", type => {
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
  const assertions = value.assertions.map(assertion => assertion.testId === 7
    ? {...assertion, actual: {complete: true, roles: {Repo: false, Component: true, Container: true, Cluster: false, Domain: false}}} : assertion)
  expect(conformance.identify({...value, assertions}, owner)).toEqual({status: "unknown", reason: "ambiguous"})
})

test("отсутствие кандидата не назначает Component по умолчанию", () => {
  const value = report("Component")
  const assertions = value.assertions.map(assertion => assertion.testId === 7
    ? {...assertion, actual: {complete: true, roles: Object.fromEntries(types.map(type => [type, false]))}} : assertion)
  expect(conformance.identify({...value, assertions}, owner)).toEqual({status: "unknown", reason: "ambiguous"})
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


test("неполное раскрытие exports сохраняет неизвестность", () => {
  const value = report("Component")
  const assertions = value.assertions.map(assertion => assertion.testId === 7
    ? {...assertion, actual: {complete: false, roles: {Repo: false, Component: true, Container: false, Cluster: false, Domain: false}}} : assertion)
  expect(conformance.identify({...value, assertions}, owner)).toEqual({status: "unknown", reason: "incomplete"})
})

test.each(["missing", "duplicate", "truncated", "partial", "non-boolean"])("%s карта кандидатов не подтверждает тип", variant => {
  const value = report("Component")
  const classification = value.assertions.find(assertion => assertion.testId === 7)!
  const assertions = variant === "missing" ? value.assertions.filter(assertion => assertion.testId !== 7)
    : variant === "duplicate" ? [...value.assertions, classification]
    : value.assertions.map(assertion => assertion.testId !== 7 ? assertion : {...assertion, actual:
      variant === "truncated" ? {$type: "truncated", reason: "time-budget"}
      : variant === "partial" ? {complete: true, roles: {Component: true}}
      : {complete: true, roles: {Repo: false, Component: "true", Container: false, Cluster: false, Domain: false}}})
  expect(conformance.identify({...value, assertions}, owner)).toEqual({status: "unknown", reason: "invalid-report"})
})

test.each(["skipped", "not-executed"] as const)("%s проверка выбранной роли не подтверждает тип даже с причиной пропуска", status => {
  const value = report("Component")
  const tests = value.tests.map(test => test.groupId === 2 ? {...test, status, skipReason: "Прежняя неприменимость"} : test)
  expect(conformance.identify({...value, tests}, owner)).toEqual({status: "unknown", reason: "incomplete"})
})

test("неподтверждённая применимость выбранной роли не становится доказательством", () => {
  const value = report("Component")
  const assertions = value.assertions.map(assertion => assertion.testId === 2 ? {...assertion, actual: {applicable: false, value: []}} : assertion)
  expect(conformance.identify({...value, assertions}, owner)).toEqual({status: "unknown", reason: "invalid-report"})
  expect(conformance.identify({...value, assertions: value.assertions.filter(assertion => assertion.testId !== 2)}, owner))
    .toEqual({status: "unknown", reason: "invalid-report"})
})

/** Исходная форма сохранённого нормативного сценария; новый source её не содержит. */
const legacySource = types.map(type => `describe.skipIf(!${type.toLowerCase()})("${type}", () => {})`).join("\n")
  + "\nNumber(repo) + Number(domain) + Number(cluster) + Number(component) + Number(container) === 1"

test.each([...types])("сохранённый прежний отчёт продолжает подтверждать %s без пересборки", type => {
  const value = report(type)
  const groups = value.groups.filter(group => group.id !== 7).map(group => types.some(type => type === group.label)
    ? {...group, mode: group.label === type ? "run" as const : "skip" as const} : group)
  const tests = value.tests.filter(test => test.id !== 7).map(test => groups.find(group => group.id === test.groupId)?.mode === "skip"
    ? {...test, status: "skipped" as const, skipReason: "Другой архетип"} : test)
  const previous = {...value, source: {...value.source, text: legacySource}, groups, tests, assertions: []}
  expect(conformance.identify(previous, owner)).toEqual({status: "confirmed", type})
  expect(conformance.identify({...previous, source: value.source}, owner)).toEqual({status: "unknown", reason: "invalid-report"})
})

test("прежняя форма не скрывает провал авторства и пропущенную обязательную проверку", () => {
  const value = report("Component")
  const groups = value.groups.map(group => types.some(type => type === group.label)
    ? {...group, mode: group.label === "Component" ? "run" as const : "skip" as const} : group)
  const previous = {...value, source: {...value.source, text: legacySource}, groups}
  const validation = {...value.validation, checks: [{rule: "general-particular", status: "failed", issues: []}]} as Report["validation"]
  expect(conformance.identify({...previous, validation}, owner)).toEqual({status: "unknown", reason: "failed"})
  const tests = value.tests.map(test => test.id === 2 ? {...test, status: "skipped" as const, skipReason: "Причина"} : test)
  expect(conformance.identify({...previous, tests}, owner)).toEqual({status: "unknown", reason: "incomplete"})
})
