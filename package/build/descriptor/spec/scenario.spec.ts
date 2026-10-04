import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import discover from "@zavx0z/storybook-package-metadata-collect"
import createGraph from "@zavx0z/storybook-package-graph-create"
import descriptors from "@zavx0z/storybook-package-build-descriptor"

describe.each([
  {name: "Все пакеты каталога", props: {include: true}, count: 1},
  {name: "Пустой выбор", props: {include: false}, count: 0},
])("$name", async ({props, count}) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-descriptor-scenario-")))
  afterAll(() => rm(root, {recursive: true, force: true}))
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/button"}))
  await mkdir(join(root, "controls"))
  await writeFile(join(root, "controls/index.ts"), "export const controls = true\n")

  const catalog = await discover([root])
  const graph = createGraph(catalog)
  const result = descriptors(catalog, graph, new Set(props.include ? ["@fixture/button"] : []))

  test("Выбранные входы сборки", () => {
    expect(result.length, "Список descriptors следует явному набору package identities")
      .toBe(count)
  })

  /** @remarks У пустого выбора нет пакетного descriptor. */
  describe.skipIf(!props.include)("Содержимое выбранного пакета", () => {
    test("Происхождение ревизии", () => {
      expect(result[0]?.sourcePath, "Пакетная ревизия привязана к исходному package.json")
        .toBe(join(root, "package.json"))
      expect(result[0]?.graphSnapshot.rootId, "Descriptor содержит снимок выбранной package identity")
        .toBe("package:@fixture/button")
    })
  })
})
