import PackageMetadataCollectOwner from "@zavx0z/storybook-package-metadata-collect"
import PackageGraphCreateOwner from "@zavx0z/storybook-package-graph-create"
import McpRestOwner from "@zavx0z/storybook-app-knowledge"
const discoverStorybookPackages = PackageMetadataCollectOwner
const createExternalStorybookGraph = PackageGraphCreateOwner
const storybookRest = McpRestOwner
import {describe, expect, test} from "bun:test"
import {join, resolve} from "node:path"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import storybookMcpEntries from "@zavx0z/storybook-app-knowledge-catalog"
import resolveRoute from "@zavx0z/storybook-package-route-resolve"

describe("Код владельца через общий каталог", async () => {
  const root = join(import.meta.dir, "../../knowledge/spec/fixture/library")
  const catalog = await discoverStorybookPackages([root])
  const graph = createExternalStorybookGraph(catalog)
  const entries = storybookMcpEntries({catalog, graph})
  const read = async (path?: string) => {
    const response = await storybookRest(new Request("http://localhost", {
      method: "POST", body: JSON.stringify(path === undefined ? {} : {path}),
    }), {projectName: "Fixture Project", entries})
    expect(response.status).toBe(200)
    return response.json()
  }

  test("Категория сохраняет расположение функции и не присваивает её контракт", async () => {
    const entry = (await read()).children[0].path
    const category = (await read(entry)).children.find((child: {path: string}) => child.path.endsWith("/text"))
    const result = await read(category.path)
    expect(result.children.map((child: {path: string}) => child.path)).toEqual([`${entry}/text/trim`])
    expect(Object.keys(result)).toEqual(["description", "path", "children"])
  })

  test("Назначение, типы и примеры берутся из тех же исходников, что видит автор", async () => {
    const selected = entries.find(entry => entry.path.endsWith("/text/trim"))!
    const result = await read(selected.path)
    expect(result.description).toContain("Удаляет пробелы по краям текста")
    expect(result.input).toEqual({type: "string", description: "Текст, у которого нужно удалить пробелы по краям."})
    expect(result.output).toEqual({type: "string", description: "Текст без пробелов по краям; строка из одних пробелов становится пустой."})
    expect(result.scenarios).toEqual([await Bun.file(join(root, "text/trim/spec/scenario.spec.ts")).text()])
    expect(result.children).toEqual([])
    expect(Object.keys(result)).toEqual(["description", "path", "children", "input", "output", "scenarios"])
    expect(JSON.stringify(result)).not.toContain(root)
    expect(await resolveRoute({route: `${selected.path}?view=contract`, roots: [{name: "lazy-content", path: root}]}))
      .toMatchObject({view: "contract", directory: join(root, "text/trim")})
  })

  test("Родитель раскрывает только детей; контракт соседней ветви не читается", async () => {
    const poisoned = entries.map(entry => entry.path.endsWith("/text/trim")
      ? {...entry, sources: {input: {path: "/missing-contract", digest: "not-read"}}} : entry)
    const response = await storybookRest(new Request("http://localhost"), {projectName: "Fixture Project", entries: poisoned})
    expect(response.status).toBe(200)
    expect((await response.json()).children).toHaveLength(1)
  })

  test("Директории недоступного пакета не становятся самостоятельными корнями", () => {
    const unavailable = {...catalog, scopes: catalog.scopes.map(scope => ({...scope, kind: "unavailable" as const}))}
    expect(storybookMcpEntries({catalog: unavailable, graph: createExternalStorybookGraph(unavailable)})).toEqual([])
  })
})

test("namespace Slots сохраняется в каталоге; неподтверждённый пакет ещё не раскрывает предметный контракт", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-mcp-slots-")))
  try {
    await mkdir(join(root, "contract"))
    await Bun.write(join(root, "package.json"), JSON.stringify({name: "@fixture/slots", type: "module", exports: {".": "./index.ts"}}))
    await Bun.write(join(root, "index.ts"), "/** Пример слотов. @packageDocumentation */\nexport default function createSlots() { return {} }\n")
    await Bun.write(join(root, "contract/index.ts"), [
      "export declare namespace FixtureSlots {",
      "  /** Вход примера. */",
      "  interface Input { value: string }",
      "  /** Результат примера. */",
      "  interface Output { accepted: boolean }",
      "  /** Авторское содержимое. */",
      "  interface Slots { header: string }",
      "}",
      "",
    ].join("\n"))
    const catalog = await discoverStorybookPackages([root])
    const graph = createExternalStorybookGraph(catalog)
    const entries = storybookMcpEntries({catalog, graph})
    const selected = entries.find(entry => entry.path.endsWith("slots"))
    expect(selected).toBeDefined()
    const response = await storybookRest(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({path: selected!.path}),
    }), {projectName: "Fixture Project", entries})
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(selected!.sources?.input?.schema).toMatchObject({type: "object", properties: {value: {type: "string"}}})
    expect(selected!.sources?.output?.schema).toMatchObject({type: "object", properties: {accepted: {type: "boolean"}}})
    expect(selected!.sources?.slots?.schema, "Слоты принадлежат тому же выбранному владельцу, что Input и Output")
      .toMatchObject({type: "object", properties: {header: {type: "string"}}})
    expect(result).toMatchObject({status: "type-unconfirmed", verification: {status: "unknown", reason: "missing-report"}})
    expect(result).not.toHaveProperty("input")
    expect(result).not.toHaveProperty("output")
    expect(result).not.toHaveProperty("slots")
    expect(JSON.stringify(result)).not.toContain(resolve(root))
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})
