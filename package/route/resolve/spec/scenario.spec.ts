/** Публичный маршрут выбирает владельца и представление, не открывая его частные исходники. */
import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import resolveRoute from "@route/resolve"

describe.each([
  {name: "Обзор владельца", props: {route: "/project/packages/component"}, expected: {node: "project/packages/component", view: "overview", packageId: "@fixture/component", relativePath: ""}},
  {name: "Публичный контракт", props: {route: "/project/packages/component?view=contract"}, expected: {node: "project/packages/component", view: "contract", packageId: "@fixture/component", relativePath: ""}},
  {name: "Частные исходники", props: {route: "/project/packages/component/src"}, expected: null},
  {name: "Отсутствующий владелец", props: {route: "/project/missing"}, expected: null},
])("$name", async ({props, expected}) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "route-scenario-")))
  const owner = join(root, "packages/component")
  afterAll(() => rm(root, {recursive: true, force: true}))
  await mkdir(join(owner, "contract"), {recursive: true})
  await mkdir(join(owner, "src"))
  await Bun.write(join(root, "package.json"), JSON.stringify({name: "@fixture/project", workspaces: ["packages/*"]}))
  await Bun.write(join(owner, "package.json"), JSON.stringify({name: "@fixture/component", exports: {".": "./index.ts"}}))
  await Bun.write(join(owner, "index.ts"), 'export default function component() {return "value"}\n')
  await Bun.write(join(owner, "contract/index.ts"), 'export declare namespace FixtureComponent {type Output = string}\n')
  const result = await resolveRoute({...props, roots: [{name: "project", path: root}]})
  test("Выбранный адрес", () => {
    expect(result === null ? null : {node: result.node, view: result.view, packageId: result.package.id, relativePath: result.relativePath},
      "Разрешается только публичный адрес и выбранное представление указанного владельца").toEqual(expected)
  })
  test("Физический владелец", () => {
    expect(result === null || result.directory === owner,
      "Успешный адрес остаётся у своего физического пакета; неизвестный и частный пути отклонены").toBeTrue()
  })
})
