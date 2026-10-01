import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import discover from "@repo/discovery"
import createGraph from "@package-graph/create"
import revision from "@package/revision"

describe.each([
  {name: "Пакет без дочерней директории", props: {directory: false}, nodeCount: 1},
  {name: "Пакет с дочерней директорией", props: {directory: true}, nodeCount: 2},
])("$name", async ({props, nodeCount}) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-revision-scenario-")))
  afterAll(() => rm(root, {recursive: true, force: true}))
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/button"}))
  if (props.directory) {
    await mkdir(join(root, "controls"))
    await writeFile(join(root, "controls/index.ts"), "export const controls = true\n")
  }

  const graph = createGraph(await discover([root]))
  const snapshot = revision.create(graph, "@fixture/button", "declaration-a")

  test("Состав проекции", () => {
    expect(snapshot.nodes.length, "Ревизия фиксирует только структурные узлы выбранного пакета")
      .toBe(nodeCount)
    expect(snapshot.rootId, "Корень снимка сохраняет точную package identity")
      .toBe("package:@fixture/button")
  })

  test("Проверяемое свидетельство", () => {
    expect(revision.validate(snapshot, "@fixture/button"), "Созданный снимок проходит проверку собственного протокола и digest")
      .toEqual(snapshot)
  })
})
