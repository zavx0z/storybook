import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import readChildren from "@zavx0z/storybook-package-route-children"

describe.each([
  {name: "Начало пакета", props: {child: "controls"}, expected: "demo/controls"},
  {name: "Другой публичный каталог", props: {child: "layout"}, expected: "demo/layout"},
  {name: "Workspace-ветка с src", props: {child: "features/group", marker: "src"}, expected: "demo/features/group"},
  {name: "Workspace-ветка с index.tsx", props: {child: "features/group", marker: "index.tsx"}, expected: "demo/features/group"},
])("$name", async ({props, expected}) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-children-scenario-")))
  afterAll(() => rm(root, {recursive: true, force: true}))
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/demo", ...(props.marker ? {workspaces: ["features/**"]} : {})}))
  await mkdir(join(root, props.child), {recursive: true})
  await writeFile(join(root, props.child, "index.ts"), "export const example = true\n")
  if (props.marker) {
    await mkdir(join(root, props.child, "tool"))
    await writeFile(join(root, props.child, "tool/package.json"), JSON.stringify({name: "@fixture/tool"}))
    if (props.marker === "src") await mkdir(join(root, "features/src"))
    else await writeFile(join(root, "features/index.tsx"), "export const value = 1\n")
  }

  const result = await readChildren({route: props.marker ? "demo/features" : "demo", roots: [{name: "demo", path: root}]})

  test("Непосредственный ребёнок", () => {
    expect(result.map(child => child.node), "Непосредственная физическая ветка видима, включая путь к workspace-пакету через модульный маркер")
      .toEqual([expected])
  })

  test("Физическое владение", () => {
    expect(result[0]?.directory, "Маршрут ребёнка связан с его действительной директорией")
      .toBe(join(root, props.child))
  })
})
