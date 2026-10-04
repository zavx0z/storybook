/** Проверяет префиксы и постфиксы соседей без подмены проверки предков. */
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readScenario from "@zavx0z/storybook-specs-scenarios-reader"

describe.each([
  {name: "Префикс соседа", own: "mcp-source", siblings: ["mcp", "identity"], repeated: ["mcp"]},
  {name: "Постфикс соседа", own: "source-mcp", siblings: ["mcp"], repeated: ["mcp"]},
  {name: "Границы регистра", own: "McpSource", siblings: ["mcp"], repeated: ["mcp"]},
  {name: "Составное имя соседа", own: "code-editor-theme", siblings: ["code-editor"], repeated: ["code-editor"]},
  {name: "Совпадение части слова", own: "transport", siblings: ["port"], repeated: []},
  {name: "Имя в середине", own: "read-mcp-source", siblings: ["mcp"], repeated: []},
  {name: "Только общее слово", own: "mcp-source", siblings: ["mcp-client"], repeated: []},
  {name: "Соседей нет", own: "source", siblings: [], repeated: []},
])("$name", ({own, siblings, repeated}) => {
  test("Вложенный сценарий выявляет точное повторение", async () => {
    const report = await readScenario({
      path: resolve(import.meta.dir, "scenario.spec.ts"),
      variant: 0,
      props: {name: own, ancestors: ["storybook", "package"], siblings},
    })
    expect(report.exitCode === 0, report.stderr).toBe(repeated.length === 0)
    expect(report.tests.find(point => point.label === "Повторение имён соседей")?.status)
      .toBe(repeated.length ? "failed" : "passed")
    expect(report.assertions.find(point => point.test === "Повторение имён соседей")?.actual).toEqual(repeated)
    expect(report.tests.find(point => point.label === "Повторение контекста вложенности")?.status).toBe("passed")
    expect(report.tests.find(point => point.label === "Смысл имени")?.status).toBe("todo")
    expect(report.validation.checks.filter(point => point.status === "failed").map(point => point.rule))
      .toEqual(repeated.length ? ["execution"] : [])
  }, 30_000)
})
