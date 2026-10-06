import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import collect from "@zavx0z/storybook-package-metadata-collect"
import createGraph from "@zavx0z/storybook-package-graph-create"
import source from "@zavx0z/storybook-package-env-source"

describe.each([{name: "Сведения выбранного Package", props: {path: resolve(import.meta.dir, "../../metadata/collect/fixtures/valid/standalone")}}])("$name", async ({props}) => {
  const catalog = await collect([props.path])
  const graph = createGraph(catalog)
  const entries = source({catalog, graph})
  test("Точная принадлежность", () => {
    expect(entries.map(entry => entry.path), "Вход соответствует выбранному пакету и не включает соседние ветви").toEqual(["standalone"])
    expect(entries[0]?.parent, "У выбранного корня нет родителя в этой области").toBeNull()
  })
  test("Подтверждение отдельно от адреса", async () => {
    expect(await entries[0]?.readType?.(), "Имя и путь не подменяют отсутствующий нормативный отчёт").toEqual({status: "unknown", reason: "missing-report"})
  })
})
