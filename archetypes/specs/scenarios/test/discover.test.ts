/**
Проверяет определение среды по пути без запуска сценария.

@packageDocumentation
*/
import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {discover} from "../src/discover"

const archetypes = resolve(import.meta.dir, "../../..")
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
