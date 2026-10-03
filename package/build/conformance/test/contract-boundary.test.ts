import {expect, setDefaultTimeout, test} from "bun:test"
import {resolve} from "node:path"
import conformance from "../index"

setDefaultTimeout(20000)

test.each([
  {name: "выводимый контракт", path: resolve(import.meta.dir, "../spec/fixture/component")},
  {name: "Input/Output и private helper", path: resolve(import.meta.dir, "../spec/fixture/contract-valid")},
])("$name проходит нормативную проверку Package", async ({path}) => {
  const report = await conformance.check(path, new AbortController().signal)
  expect(conformance.verify(report), "Простая выводимая форма и корректный авторский контракт не имеют нормативных ошибок")
    .toEqual({status: "passed", diagnostics: []})
})

test("лишняя публичная роль namespace отвергается исходным сценарием Package", async () => {
  const path = resolve(import.meta.dir, "../spec/fixture/contract-invalid")
  const report = await conformance.check(path, new AbortController().signal)
  const verification = conformance.verify(report)
  expect(verification.status, "Ошибка Contracts становится отказом общего нормативного сценария")
    .toBe("failed")
  expect(report.tests.filter(item => item.status === "failed").map(item => item.label),
    "Провал принадлежит проверке типовой границы, а не ошибке запуска сценария")
    .toEqual(["Диагностика публичной границы"])
  expect(verification.diagnostics.some(item => item.message.includes("Relocation")),
    "Диагностика сохраняет причину: дополнительная публичная роль не входит в Input, Output или Slots")
    .toBeTrue()
})
