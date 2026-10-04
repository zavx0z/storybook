import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import discover from "@zavx0z/storybook-package-metadata-collect"
import createGraph from "@zavx0z/storybook-package-graph-create"

describe.each([
  {name: "Только пакет", props: {directory: false}, ids: ["package:@fixture/button"]},
  {name: "Пакет с директорией", props: {directory: true}, ids: ["package:@fixture/button", "directory:package:@fixture/button/controls"]},
])("$name", async ({props, ids}) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-graph-scenario-")))
  afterAll(() => rm(root, {recursive: true, force: true}))
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/button"}))
  if (props.directory) {
    await mkdir(join(root, "controls"))
    await writeFile(join(root, "controls/index.ts"), "export const controls = true\n")
  }

  const catalog = await discover([root])
  const graph = createGraph(catalog)

  test("Идентичности структурных узлов", () => {
    expect(graph.nodes.map(node => node.id), "Граф сохраняет пакет и его физическую публичную директорию в порядке обхода")
      .toEqual([...ids])
  })

  test("Корень и ревизия графа", () => {
    expect(graph.rootIds, "Один подключённый пакет даёт ровно один корень графа")
      .toEqual(["package:@fixture/button"])
    expect(graph.digest, "Содержимое графа имеет сравнимый SHA-256 digest")
      .toMatch(/^[a-f0-9]{64}$/u)
  })
})
