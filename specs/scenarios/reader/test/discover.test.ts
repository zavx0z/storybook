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
    {module: resolve(storybook, "package/package-json/index.ts"), names: ["default"]},
    {module: resolve(storybook, "package/route/ignored/index.ts"), names: ["default"]},
    {module: resolve(storybook, "contracts/index.ts"), names: ["default"]},
    {module: resolve(storybook, "domain/index.ts"), names: ["default"]},
    {module: resolve(storybook, "specs/scenarios/reader/index.ts"), names: ["default"]},
    {module: resolve(storybook, "package/reader/spec/runtime-owned-parts.ts"), names: ["runtimeOwnedParts"]},
  ])
})

test("находит preload и JSX runtime компонента", async () => {
  const result = await discover(resolve(immersive, "nodes/node/diagram/spec/scenario.spec.tsx"))
  expect(result, "Среда должна соответствовать test script владельца компонента").toMatchObject({
    cwd: resolve(immersive, "nodes/node/diagram"),
    preload: [resolve(immersive, "headless/preload.ts")],
    jsxImportSource: "@zavx0z/immersive/XReact",
  })
})

test("путь ./spec в команде тестов сохраняет preload примера", async () => {
  const result = await discover(resolve(import.meta.dir, "../spec/fixture/component/spec/scenario.spec.tsx"))
  expect(result.preload).toContain(Bun.resolveSync("@zavx0z/immersive/headless/preload", import.meta.dir))
  expect(result.jsxImportSource).toBe("@zavx0z/immersive/XReact")
})


test.each(["app/web/page", "app/web/page/package", "app/web/page/shell/workbench"])("%s получает общий compiler без локальной настройки", async owner => {
  const result = await discover(resolve(storybook, owner, "spec/scenario.spec.ts"))
  expect(result.cwd).toBe(resolve(storybook, owner))
  expect(result.preload).toEqual([resolve(storybook, "app/web/test/fixture/compile-workbench.ts")])
  expect(result.jsxImportSource).toBe("@zavx0z/immersive/XReact")
})
