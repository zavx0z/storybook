import {afterAll, describe, expect, test} from "bun:test"
import {mkdir, mkdtemp, rm, symlink} from "node:fs/promises"
import {resolve} from "node:path"
import {tmpdir} from "node:os"
import {formatRouteAddress} from "@storybook/route/address"
import {readRouteChildren} from "@storybook/route/children"
import {resolveRoute} from "@storybook/route"

const storybookPath = resolve(import.meta.dir, "../..")
const webxrPath = resolve(storybookPath, "../webxr-space")
const roots = [
  {name: "storybook", path: storybookPath},
  {name: "webxr", path: webxrPath},
] as const
const temporaryPaths: string[] = []

afterAll(async () => {
  for (const path of temporaryPaths) await rm(path, {recursive: true, force: true})
})

describe("Текущая публичная структура", () => {
  test("Открывает сценарии Diagram", async () => {
    expect(await resolveRoute({route: "/webxr/nodes/node/diagram?view=scenarios", roots})).toMatchObject({
      node: "webxr/nodes/node/diagram",
      pathname: "/webxr/nodes/node/diagram",
      package: {id: "@nodes/node", path: resolve(webxrPath, "nodes/node")},
      directory: resolve(webxrPath, "nodes/node/diagram"),
      relativePath: "diagram",
      view: "scenarios",
      views: ["scenarios", "contract", "dependencies"],
    })
  })

  test("Сохраняет самостоятельную сущность scenarios", async () => {
    expect(await resolveRoute({route: "storybook/archetypes/specs/scenarios", roots})).toMatchObject({
      package: {id: "@archetypes/specs"},
      directory: resolve(storybookPath, "archetypes/specs/scenarios"),
      relativePath: "scenarios",
      view: "overview",
    })
  })

  test("Открывает сценарии самостоятельной сущности через query", async () => {
    expect(await resolveRoute({route: "storybook/archetypes/specs/scenarios?view=scenarios", roots})).toMatchObject({
      node: "storybook/archetypes/specs/scenarios",
      relativePath: "scenarios",
      view: "scenarios",
    })
  })

  test("Декодирует выбранный вариант", async () => {
    expect(await resolveRoute({route: "webxr/nodes/node/diagram?view=scenarios&variant=%D0%9A%D1%80%D1%83%D0%B3", roots})).toMatchObject({
      variant: "Круг",
      pathname: "/webxr/nodes/node/diagram",
    })
  })

  test("Возвращает только structural children Diagram", async () => {
    expect(await readRouteChildren({route: "webxr/nodes/node/diagram", roots})).toEqual([])
  })

  test("Проходит через workspace prefix к ближайшему пакету", async () => {
    expect(await resolveRoute({route: "storybook/mcp/rest", roots})).toMatchObject({
      package: {id: "@mcp/rest", path: resolve(storybookPath, "mcp/rest")},
      relativePath: "",
      view: "overview",
    })
  })

  test("Открывает exact authored story корневой документации", async () => {
    expect(await resolveRoute({route: "storybook/stories/contract/overview", roots})).toMatchObject({
      package: {id: "@zavx0z/storybook", path: storybookPath},
      directory: resolve(storybookPath, ".storybook/stories"),
      relativePath: "stories/contract/overview",
      view: "story",
    })
  })

  test("Открывает authored overview категории корневой документации", async () => {
    expect(await resolveRoute({route: "storybook/stories", roots})).toMatchObject({
      directory: storybookPath,
      relativePath: "stories",
      view: "story",
    })
  })

  test("Открывает authored overview предмета корневой документации", async () => {
    expect(await resolveRoute({route: "storybook/stories/contract", roots})).toMatchObject({
      directory: storybookPath,
      relativePath: "stories/contract",
      view: "story",
    })
  })

  test("Открывает прежний ParameterNode variant", async () => {
    expect(await resolveRoute({route: "webxr/nodes/node/components/node/basic", roots})).toMatchObject({
      package: {id: "@nodes/node", path: resolve(webxrPath, "nodes/node")},
      directory: resolve(webxrPath, "nodes/node/.storybook/stories"),
      relativePath: "components/node/basic",
      view: "story",
    })
  })

  test("Строит browser-safe адрес", () => {
    expect(formatRouteAddress({node: "storybook/сущность", view: "scenarios", variant: "Круг"})).toBe(
      "/storybook/%D1%81%D1%83%D1%89%D0%BD%D0%BE%D1%81%D1%82%D1%8C?view=scenarios&variant=%D0%9A%D1%80%D1%83%D0%B3",
    )
  })
})

describe("Изменяемая структура без предварительного реестра", () => {
  test("Открывает физический компонент без package exports", async () => {
    const root = await createPackage({exports: {}})
    await mkdir(resolve(root, "category/component/private"), {recursive: true})
    await Bun.write(resolve(root, "category/index.ts"), "export * from './component'\n")
    await Bun.write(resolve(root, "category/component/index.tsx"), "export function Component() { return <article /> }\n")
    const physicalRoots = [{name: "physical", path: root}]

    expect(await Promise.all([
      resolveRoute({route: "physical/category/component", roots: physicalRoots}),
      resolveRoute({route: "physical/category/component/private", roots: physicalRoots}),
      readRouteChildren({route: "physical/category", roots: physicalRoots}),
    ])).toMatchObject([
      {relativePath: "category/component", view: "overview"},
      null,
      [{relativePath: "category/component"}],
    ])
  })

  test("Не открывает private и Git-ignored директории", async () => {
    const root = await createPackage({exports: {}})
    await Bun.spawn(["git", "init", "--quiet", root]).exited
    for (const path of ["spec/child", "src/child", "shared/child", "fixture/child", ".hidden/child", "ignored/child"]) {
      await mkdir(resolve(root, path), {recursive: true})
    }
    await Bun.write(resolve(root, ".gitignore"), "ignored/\n")
    const privateRoots = [{name: "private", path: root}]

    expect(await Promise.all([
      ...["spec", "src", "shared", "fixture", ".hidden", "ignored"].map(path => (
        resolveRoute({route: `private/${path}`, roots: privateRoots})
      )),
      readRouteChildren({route: "private", roots: privateRoots}),
    ])).toEqual([null, null, null, null, null, null, []])
  })

  test("Тот же resolver видит созданного после первого вызова ребёнка", async () => {
    const root = await createPackage({exports: {"./created": "./created/index.ts"}})
    const dynamicRoots = [{name: "dynamic", path: root}]
    const before = await resolveRoute({route: "dynamic/created", roots: dynamicRoots})
    await mkdir(resolve(root, "created"))
    await Bun.write(resolve(root, "created/index.ts"), "export const created = true\n")
    const after = await resolveRoute({route: "dynamic/created", roots: dynamicRoots})

    expect({before, after}).toMatchObject({
      before: null,
      after: {node: "dynamic/created", relativePath: "created", view: "overview"},
    })
  })

  test("Публичная сущность scenarios имеет приоритет над view владельца", async () => {
    const root = await createPackage({exports: {"./scenarios": "./scenarios/index.ts"}})
    await mkdir(resolve(root, "spec"))
    await Bun.write(resolve(root, "spec/scenario.spec.ts"), "")
    await mkdir(resolve(root, "scenarios/spec"), {recursive: true})
    await Bun.write(resolve(root, "scenarios/index.ts"), "export const scenarios = true\n")
    await Bun.write(resolve(root, "scenarios/spec/scenario.spec.ts"), "")
    const collisionRoots = [{name: "collision", path: root}]

    expect(await Promise.all([
      resolveRoute({route: "collision/scenarios", roots: collisionRoots}),
      resolveRoute({route: "collision/scenarios?view=scenarios", roots: collisionRoots}),
      resolveRoute({route: "collision?view=scenarios", roots: collisionRoots}),
    ])).toMatchObject([
      {relativePath: "scenarios", view: "overview", views: ["scenarios"]},
      {relativePath: "scenarios", view: "scenarios", views: ["scenarios"]},
      {relativePath: "", view: "scenarios", views: ["scenarios"]},
    ])
  })

  test("File export не создаёт дочерний structural узел", async () => {
    const root = await createPackage({exports: {"./buttons/button": "./buttons/button.ts"}})
    await mkdir(resolve(root, "buttons/spec"), {recursive: true})
    await Bun.write(resolve(root, "buttons/index.ts"), "export * from './button'\n")
    await Bun.write(resolve(root, "buttons/button.ts"), "export const button = true\n")
    await Bun.write(resolve(root, "buttons/spec/scenario.spec.ts"), "")
    const leafRoots = [{name: "leaf", path: root}]

    expect(await Promise.all([
      resolveRoute({route: "leaf/buttons?view=scenarios", roots: leafRoots}),
      resolveRoute({route: "leaf/buttons/button?view=scenarios", roots: leafRoots}),
    ])).toMatchObject([
      {relativePath: "buttons", view: "scenarios"},
      null,
    ])
  })
})

describe.each([
  {name: "несуществующий узел", route: "webxr/nodes/node/unknown"},
  {name: "переход наверх", route: "webxr/nodes/node/../diagram"},
  {name: "кодированный slash", route: "webxr/nodes/node/diagram%2Fcontract"},
  {name: "дважды кодированный slash", route: "webxr/nodes/node/diagram%252Fcontract"},
  {name: "приватная spec", route: "webxr/nodes/node/diagram/spec"},
  {name: "незарегистрированный корень", route: "unknown/nodes"},
  {name: "необъявленная authored story", route: "storybook/stories/contract/missing"},
  {name: "прежний suffix сценариев", route: "webxr/nodes/node/diagram/scenarios"},
  {name: "недоступный view", route: "storybook/archetypes/specs?view=dependencies"},
  {name: "view authored story", route: "storybook/stories/contract/overview?view=scenarios"},
])("Недоступен $name", ({route}) => {
  test("Возвращает null", async () => {
    expect(await resolveRoute({route, roots})).toBeNull()
  })
})

test("Не проходит через symlink директории", async () => {
  const root = await createPackage({exports: {"./escaped": "./escaped/index.ts"}})
  const outside = await mkdtemp(resolve(tmpdir(), "storybook-route-outside-"))
  temporaryPaths.push(outside)
  await Bun.write(resolve(outside, "index.ts"), "export const escaped = true\n")
  await symlink(outside, resolve(root, "escaped"))

  expect(await resolveRoute({route: "secure/escaped", roots: [{name: "secure", path: root}]})).toBeNull()
})

test("Не читает представление через внешний symlink директории spec", async () => {
  const root = await createPackage({exports: {}})
  const outside = await mkdtemp(resolve(tmpdir(), "storybook-route-spec-outside-"))
  temporaryPaths.push(outside)
  await Bun.write(resolve(outside, "scenario.spec.ts"), "")
  await symlink(outside, resolve(root, "spec"))

  expect(await resolveRoute({route: "secure?view=scenarios", roots: [{name: "secure", path: root}]})).toBeNull()
})

test("Не читает представление через внутренний symlink директории spec", async () => {
  const root = await createPackage({exports: {}})
  await mkdir(resolve(root, "scenario-source"))
  await Bun.write(resolve(root, "scenario-source/scenario.spec.ts"), "")
  await symlink(resolve(root, "scenario-source"), resolve(root, "spec"))

  expect(await resolveRoute({route: "secure?view=scenarios", roots: [{name: "secure", path: root}]})).toBeNull()
})

/** Создаёт минимальный временный пакет с заданной картой публичных входов. */
async function createPackage({exports}: {readonly exports: Readonly<Record<string, string>>}): Promise<string> {
  const path = await mkdtemp(resolve(tmpdir(), "storybook-route-"))
  temporaryPaths.push(path)
  await Bun.write(resolve(path, "package.json"), JSON.stringify({
    name: `@fixture/${path.split("/").at(-1)}`,
    exports,
  }))
  return path
}
