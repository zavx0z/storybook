import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {discoverStorybookPackages} from "../discovery/packages"
import {createExternalStorybookGraph} from "./graph"
import {storybookMcpEntries} from "./mcp"
import {storybookRest} from "@mcp/rest"
import {resolveRoute} from "@storybook/route"

describe("Код владельца через общий каталог", async () => {
  const root = join(import.meta.dir, "../mcp/rest/spec/fixture/library")
  const catalog = await discoverStorybookPackages([root])
  const graph = createExternalStorybookGraph(catalog)
  const entries = storybookMcpEntries({catalog, graph})
  const read = async (path?: string) => {
    const response = await storybookRest(new Request("http://localhost", {
      method: "POST", body: JSON.stringify(path === undefined ? {} : {path}),
    }), {entries})
    expect(response.status).toBe(200)
    return response.json()
  }

  test("Категория сохраняет расположение функции и не присваивает её контракт", async () => {
    const entry = (await read()).children[0].path
    const category = (await read(entry)).children.find((child: {path: string}) => child.path.endsWith("/text"))
    const result = await read(category.path)
    expect(result.children.map((child: {path: string}) => child.path)).toEqual([`${entry}/text/trim`])
    expect(Object.keys(result)).toEqual(["path", "description", "children"])
  })

  test("Назначение, типы и примеры берутся из тех же исходников, что видит автор", async () => {
    const selected = entries.find(entry => entry.path.endsWith("/text/trim"))!
    const result = await read(selected.path)
    expect(result.description).toContain("Удаляет пробелы по краям текста")
    expect(result.input).toEqual({type: "string", description: "Текст, у которого нужно удалить пробелы по краям."})
    expect(result.output).toEqual({type: "string", description: "Текст без пробелов по краям; строка из одних пробелов становится пустой."})
    expect(result.scenarios).toEqual([await Bun.file(join(root, "text/trim/spec/scenario.spec.ts")).text()])
    expect(result.children).toEqual([])
    expect(Object.keys(result)).toEqual(["path", "description", "children", "input", "output", "scenarios"])
    expect(JSON.stringify(result)).not.toContain(root)
    expect(await resolveRoute({route: `${selected.path}?view=contract`, roots: [{name: "lazy-content", path: root}]}))
      .toMatchObject({view: "contract", directory: join(root, "text/trim")})
  })

  test("Родитель раскрывает только детей; контракт соседней ветви не читается", async () => {
    const poisoned = entries.map(entry => entry.path.endsWith("/text/trim")
      ? {...entry, sources: {input: {path: "/missing-contract", digest: "not-read"}}} : entry)
    const response = await storybookRest(new Request("http://localhost"), {entries: poisoned})
    expect(response.status).toBe(200)
    expect((await response.json()).children).toHaveLength(1)
  })

  test("Директории недоступного пакета не становятся самостоятельными корнями", () => {
    const unavailable = {...catalog, scopes: catalog.scopes.map(scope => ({...scope, kind: "unavailable" as const}))}
    expect(storybookMcpEntries({catalog: unavailable, graph: createExternalStorybookGraph(unavailable)})).toEqual([])
  })
})
