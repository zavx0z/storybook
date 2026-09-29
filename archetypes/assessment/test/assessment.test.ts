import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {resolve} from "node:path"
import {readAssessment} from "@archetypes/assessment"
import {assessmentDiagnostics, executeOwnedScenario, executeStandard, matchesClass} from "../src/execute"
import type {ReadAssessmentOutput} from "../contract/output"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true})
})

/** Минимальная запись технического отчёта для проверки границы принятия решения, без запуска кода. */
function record(applicable: boolean, status: "passed" | "failed" | "incomplete"): ReadAssessmentOutput["reports"][number] {
  return {archetype: "domain", applicable, status, message: "Не удалось проверить"}
}

test("неприменимая отрицательная проба не становится предупреждением о другом классе", () => {
  expect(assessmentDiagnostics([record(false, "failed")], "/owner")).toEqual([])
  expect(assessmentDiagnostics([record(true, "incomplete")], "/owner")).toEqual([
    {rule: "domain", status: "not-checked", path: "/owner", message: "Не удалось проверить"},
  ])
  expect(matchesClass(record(false, "passed"), "Domain")).toBeFalse()
})

test("отмена оценки не превращается в incomplete или passed", async () => {
  const signal = AbortSignal.abort(new Error("Оценка отменена"))
  await expect(readAssessment({path: resolve(import.meta.dir, "../../component"), signal})).rejects.toThrow("Оценка отменена")
})

test("отсутствующий обязательный сценарий Component остаётся непроверенностью стандарта", async () => {
  const result = await executeOwnedScenario({path: resolve(import.meta.dir, "missing-owner")})
  expect(result).toEqual({archetype: "behavior", applicable: true, status: "incomplete",
    message: "Для проверки поведения нужен один непосредственный сценарий владельца"})
  expect(assessmentDiagnostics([result], "/owner")[0]?.status).toBe("not-checked")
})

test("отсутствующий необязательный сценарий Domain не создаёт провал или предупреждение", async () => {
  expect(await executeOwnedScenario({path: resolve(import.meta.dir, "missing-owner")}, true)).toBeUndefined()
  await expect(executeOwnedScenario({path: import.meta.dir, signal: AbortSignal.abort(new Error("Отмена"))}, true)).rejects.toThrow("Отмена")
})

test("существующий необязательный сценарий сохраняет настоящий провал", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "domain-optional-scenario-"))
  roots.push(root)
  await mkdir(resolve(root, "spec"))
  await writeFile(resolve(root, "package.json"), JSON.stringify({name: "@fixture/domain-optional", type: "module"}))
  await writeFile(resolve(root, "spec/scenario.spec.ts"), [
    'import {describe, expect, test} from "bun:test"',
    'describe.each([{name: "Нарушение"}])("$name", () => {',
    '  test("Предметное правило", () => { expect(1, "Нарушенное правило не скрывается необязательностью файла").toBe(2) })',
    '})',
  ].join("\n"))
  const result = await executeOwnedScenario({path: root}, true)
  expect(result?.status).toBe("failed")
  expect(result?.report?.exitCode).not.toBe(0)
  expect(result?.report?.tests.some(test => test.status === "failed")).toBeTrue()
  await writeFile(resolve(root, "spec/scenario.spec.tsx"), "throw new Error('Не запускать неоднозначный источник')")
  const ambiguous = await executeOwnedScenario({path: root}, true)
  expect(ambiguous?.status).toBe("incomplete")
  expect(ambiguous?.report).toBeUndefined()
}, 20000)

test("ошибка чтения нормативного исходника прерывает оценку", async () => {
  await expect(executeStandard("missing", "missing/spec/scenario.spec.ts", {path: import.meta.dir})).rejects.toThrow()
})
