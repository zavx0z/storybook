/**
Создание и чтение одной сущности Graph через два средовых входа.

@packageDocumentation
*/
import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import discover from "@storybook-repo/discovery"
import createGraph from "@storybook-package/graph"
import readGraph from "../web"

describe.each([{name: "Один граф в двух средах", props: {name: "@fixture/graph"}}])("$name", async ({props}) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "graph-domain-")))
  afterAll(() => rm(root, {recursive: true, force: true}))
  await Bun.write(join(root, "package.json"), JSON.stringify({name: props.name}))
  const catalog = await discover([root])
  const graph = createGraph(catalog)
  test("Общая identity", () => {
    expect(readGraph.node(graph, graph.rootIds[0]!).packageId, "Чтение сохраняет identity, установленную созданием графа").toBe(props.name)
  })
  test("Общий маршрут", () => {
    expect(readGraph.resolve(graph, props.name, "").nodeId, "Средовые обязанности используют один проверенный граф")
      .toBe(graph.rootIds[0]!)
  })
  test("Неизменяемый снимок", () => {
    expect(Object.isFrozen(graph), "Чтение не создаёт вторую изменяемую модель").toBeTrue()
    expect(graph.nodes, "Один обнаруженный пакет образует один узел графа").toHaveLength(1)
  })
})
