/**
Проверяет определение среды по пути без запуска сценария.

@packageDocumentation
*/
import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {discover} from "../src/discover"

const archetypes = resolve(import.meta.dir, "../../../archetypes")
const webxr = resolve(archetypes, "../../webxr-space")

test("находит импорт серверной функции", async () => {
  const result = await discover(resolve(archetypes, "package/spec/scenario.spec.ts"))
  expect(result.observe, "Импорты должны определяться из файла сценария").toEqual([
    {module: resolve(archetypes, "package/index.ts")},
  ])
})

test("находит preload и JSX runtime компонента", async () => {
  const result = await discover(resolve(webxr, "nodes/node/diagram/spec/scenario.spec.tsx"))
  expect(result, "Среда должна соответствовать test script владельца компонента").toMatchObject({
    cwd: resolve(webxr, "nodes/node"),
    preload: [resolve(webxr, "headless/preload.ts")],
    jsxImportSource: "@immersive/headless",
  })
})

test("путь ./spec в команде тестов сохраняет preload примера", async () => {
  const result = await discover(resolve(import.meta.dir, "../spec/fixture/component/spec/scenario.spec.tsx"))
  expect(result.preload).toContain(Bun.resolveSync("@immersive/headless/preload", import.meta.dir))
  expect(result.jsxImportSource).toBe("@immersive/headless")
})
