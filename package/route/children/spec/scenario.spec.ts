import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import readChildren from "@zavx0z/storybook-package-route-children"

describe.each([
  {name: "Начало пакета", props: {child: "controls"}, expected: "demo/controls"},
  {name: "Другой публичный каталог", props: {child: "layout"}, expected: "demo/layout"},
])("$name", async ({props, expected}) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-children-scenario-")))
  afterAll(() => rm(root, {recursive: true, force: true}))
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/demo"}))
  await mkdir(join(root, props.child))
  await writeFile(join(root, props.child, "index.ts"), "export const example = true\n")

  const result = await readChildren({route: "demo", roots: [{name: "demo", path: root}]})

  test("Непосредственный ребёнок", () => {
    expect(result.map(child => child.node), "Публичный каталог доступен как один структурный ребёнок корня")
      .toEqual([expected])
  })

  test("Физическое владение", () => {
    expect(result[0]?.directory, "Маршрут ребёнка связан с его действительной директорией")
      .toBe(join(root, props.child))
  })
})
