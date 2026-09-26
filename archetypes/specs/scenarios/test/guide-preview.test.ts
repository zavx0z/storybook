import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {readScenario, supportsScenarioPreview} from "@storybook/app/scenarios"

test.each([
  {name: "Руководство сценариев", path: resolve(import.meta.dir, "../spec/scenario.spec.ts"), count: 2},
  {name: "Руководство спецификаций", path: resolve(import.meta.dir, "../../spec/scenario.spec.ts"), count: 4},
])("$name доступно в App как кодовый пример", async ({path, count}) => {
  expect(await supportsScenarioPreview({path}), "Статический просмотр распознаёт прямой публичный вызов Archetypes").toBeTrue()
  const report = await readScenario({path})
  expect(report.preview?.kind, "Полный запуск даёт функцию-пример для приложения").toBe("function")
  if (report.preview?.kind !== "function") return
  expect(report.preview.variants, "Каждый авторский вариант доступен для выбора").toHaveLength(count)
  for (const variant of report.preview.variants) {
    expect(variant.calls.length, "Вариант действительно вызвал проектор Archetypes").toBeGreaterThan(0)
    const outcome = variant.calls[0]?.outcome
    expect(outcome?.type, "Возвращено руководство, а не ошибка запуска").toBe("resolve")
    if (outcome?.type !== "resolve") continue
    expect(outcome.value, "Вывод содержит файлы, кодовые примеры и правила").toMatchObject({
      files: expect.any(Array),
      examples: expect.any(Array),
      checks: expect.any(Array),
    })
    expect(outcome.value, "Полный технический отчёт остаётся у App").not.toHaveProperty("junit")
  }
}, 30_000)
