import {XMLParser, XMLValidator} from "fast-xml-parser"
import type {ScenarioGroup, ScenarioTest} from "./types"

/** Сопоставляет зарегистрированные пункты с исходами штатного runner, включая failing и пропуски. */
export function applyReport(xml: string, groups: readonly ScenarioGroup[], tests: readonly ScenarioTest[]): readonly ScenarioTest[] {
  if (/<!DOCTYPE/iu.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Некорректный JUnit сценария")
  const parser = new XMLParser({
    ignoreAttributes: false, attributeNamePrefix: "", parseTagValue: false, parseAttributeValue: false,
    trimValues: false, htmlEntities: true,
    isArray: name => ["testsuite", "testcase", "failure", "error", "skipped"].includes(name),
  })
  const parsed = parser.parse(xml) as {testsuites?: Record<string, unknown>}
  if (!parsed.testsuites) throw new Error("В JUnit отсутствует testsuites")
  const cases: {item: Record<string, unknown>, labels: string[]}[] = []
  const visit = (suite: Record<string, unknown>, labels: string[], depth: number) => {
    cases.push(...((suite.testcase ?? []) as Record<string, unknown>[]).map(item => ({item, labels})))
    for (const child of (suite.testsuite ?? []) as Record<string, unknown>[]) visit(child, depth === 0 ? [] : [...labels, String(child.name)], depth + 1)
  }
  visit(parsed.testsuites, [], 0)
  const remaining = [...cases]
  const result = tests.map(test => {
    const labels: string[] = []
    let groupId = test.groupId
    while (groupId !== null) {
      const group = groups.find(group => group.id === groupId)
      if (!group) throw new Error(`Не найдена группа ${groupId}`)
      labels.unshift(group.label)
      groupId = group.parentId
    }
    const index = remaining.findIndex(entry => entry.item.name === test.label && JSON.stringify(entry.labels) === JSON.stringify(labels))
    if (index < 0) throw new Error(`Нет результата Bun для ${[...labels, test.label].join(" > ")}`)
    const {item} = remaining.splice(index, 1)[0]!
    const failure = ((item.failure ?? item.error ?? []) as Record<string, unknown>[])[0]
    const status: ScenarioTest["status"] = item.error !== undefined ? "error" : item.failure !== undefined ? "failed"
      : item.skipped !== undefined ? test.mode === "todo" ? "todo" : "skipped" : "passed"
    return {...test, status, skipReason: status === "skipped" ? test.skipReason : null, message: failure ? String(failure["#text"] ?? failure.message ?? "") : null}
  })
  if (remaining.length) throw new Error(`Инспектор не зарегистрировал ${remaining.length} тестов из JUnit`)
  return result
}
