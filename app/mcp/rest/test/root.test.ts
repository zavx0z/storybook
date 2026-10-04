import {expect, test} from "bun:test"
import rest from "@zavx0z/storybook-app-mcp-rest"

const entries = [
  {path: "storybook/package", description: "Пакеты", parent: "storybook"},
  {path: "storybook/package/build", description: "Сборка", parent: "storybook/package"},
  {path: "storybook/package/build/descriptor", description: "Описание сборки", parent: "storybook/package/build"},
  {path: "storybook/package-other", description: "Сосед", parent: "storybook"},
]
const options = {projectName: "Project", entries, root: {path: "storybook/package"}}
const request = (input: unknown = {}) => new Request("http://localhost", {method: "POST", body: JSON.stringify(input)})

test("точка обозначает root, а адреса выбранного узла и children сохраняют начало отсчёта", async () => {
  const root = await (await rest(request(), options)).json()
  expect(root).toEqual({description: "Пакеты", path: ".", children: [{description: "Сборка", path: "./build"}]})
  const build = await (await rest(request({path: root.children[0].path}), options)).json()
  expect(build).toEqual({description: "Сборка", path: "./build", children: [{description: "Описание сборки", path: "./build/descriptor"}]})
  expect(await (await rest(request({path: build.path}), options)).json()).toEqual(build)
  expect(await (await rest(request({path: build.children[0].path}), options)).json())
    .toEqual({description: "Описание сборки", path: "./build/descriptor", children: []})
  expect(await (await rest(request(), options)).json()).toEqual(root)
  expect(await (await rest(request({path: "."}), options)).json()).toEqual(root)
  expect((await rest(request({path: "./descriptor"}), options)).status).toBe(403)
  expect((await rest(request({path: "descriptor"}), options)).status).toBe(403)
  expect((await rest(request({path: "storybook/package/build"}), options)).status).toBe(403)
  expect((await rest(request({path: "storybook/package-other"}), options)).status).toBe(403)
  expect((await rest(request({path: "../package-other"}), options)).status).toBe(400)
  expect((await rest(request({root: "storybook"}), options)).status).toBe(400)
})

test("проекция root не раскрывает контракты соседей и не меняет исходные пути", async () => {
  let reads = 0
  const selected = {...entries[0]!, get sources() { reads += 1; return {} }}
  const child = {...entries[1]!, get sources(): never { throw new Error("Соседняя схема не читается") }}
  expect((await rest(request(), {...options, entries: [selected, child]})).status).toBe(200)
  expect(reads).toBe(1)
  expect(selected.path).toBe("storybook/package")
  expect(child.parent).toBe("storybook/package")
})

test("в общем входе Project адрес ребёнка сохраняет путь от Project", async () => {
  const response = await rest(request({path: "storybook/package/build"}), {projectName: "Project", entries})
  expect(await response.json()).toEqual({description: "Сборка", path: "./storybook/package/build", children: [{description: "Описание сборки", path: "./storybook/package/build/descriptor"}]})
  const project = await (await rest(request({path: "."}), {projectName: "Project", entries: []})).json()
  expect(project.path).toBe(".")
})
