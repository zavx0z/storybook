/**
Проверяет определение среды по пути без запуска сценария.

@packageDocumentation
*/
import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {discover} from "../src/discover"

const storybook = resolve(import.meta.dir, "../../../..")
const immersive = resolve(storybook, "../immersive")

test("находит импорт серверной функции", async () => {
  const result = await discover(resolve(storybook, "package/reader/spec/scenario.spec.ts"))
  expect(result.observe, "Импорты должны определяться из файла сценария").toEqual([
    {module: resolve(storybook, "package/reader/index.ts"), names: ["default"]},
  ])
})

test("находит preload и JSX runtime компонента", async () => {
  const result = await discover(resolve(immersive, "nodes/node/diagram/spec/scenario.spec.tsx"))
  expect(result, "Среда должна соответствовать test script владельца компонента").toMatchObject({
    cwd: resolve(immersive, "nodes/node"),
    preload: [resolve(immersive, "headless/preload.ts")],
    jsxImportSource: "@immersive/jsx",
  })
})

test("путь ./spec в команде тестов сохраняет preload примера", async () => {
  const result = await discover(resolve(import.meta.dir, "../spec/fixture/component/spec/scenario.spec.tsx"))
  expect(result.preload).toContain(Bun.resolveSync("@immersive/headless/preload", import.meta.dir))
  expect(result.jsxImportSource).toBe("@immersive/jsx")
})
