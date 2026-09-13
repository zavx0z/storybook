/**
Запускает сценарий пакета отдельным Bun Test и получает историю spyOn после его завершения.
Сам тест не импортирует сценарий или проверяемую функцию и не устанавливает spyOn.

@packageDocumentation
*/
import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {readSpy} from "../src/spy-on"

const result = await readSpy({path: resolve(import.meta.dir, "../../../package/spec/scenario.spec.ts")})
const spy = result.spies.find(spy => spy.name === "readPackage")

test("Запущенный сценарий завершился успешно", () => {
  expect(result.exitCode).toBe(0)
})

test("История содержит пути обоих вызовов", () => {
  expect(spy?.history).toMatchObject({calls: [
    [{path: resolve(import.meta.dir, "../../..")}],
    [{path: resolve(import.meta.dir, "../..")}],
  ]})
})

test("История содержит результаты завершённых вызовов", () => {
  expect(spy?.history).toMatchObject({results: [
    {type: "return", value: {type: "promise", status: "fulfilled", value: {packageJson: {name: "@storybook/archetypes"}}}},
    {type: "return", value: {type: "promise", status: "fulfilled", value: {packageJson: {name: "@archetypes/specs"}}}},
  ]})
})

test("Получена история spyOn из завершённого запуска", () => {
  expect(result.spies).toMatchSnapshot()
})
