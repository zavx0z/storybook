import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import discover from "@zavx0z/storybook-package-metadata-collect"
import createGraph from "@zavx0z/storybook-package-graph-create"
import readGraph from "@zavx0z/storybook-package-graph-read"

describe.each([
  {name: "Обзор пакета", props: {route: "", nodeId: "package:@fixture/button"}},
  {name: "Обзор директории", props: {route: "dir-controls", nodeId: "directory:package:@fixture/button/controls"}},
])("$name", async ({props}) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-read-graph-scenario-")))
  afterAll(() => rm(root, {recursive: true, force: true}))
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/button"}))
  await mkdir(join(root, "controls"))
  await writeFile(join(root, "controls/index.ts"), "export const controls = true\n")

  const graph = createGraph(await discover([root]))
  const route = readGraph.resolve(graph, "@fixture/button", props.route)

  test("Точное разрешение маршрута", () => {
    expect(route.nodeId, "Маршрут выбирает узел выбранного пакета без подстановки потомка")
      .toBe(props.nodeId)
  })

  test("Канонический адрес", () => {
    expect(readGraph.node(graph, route.nodeId).urlPath, "URL маршрута совпадает с адресом соответствующего структурного узла")
      .toBe(route.urlPath)
  })
})
