import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import readDirectories from "@zavx0z/storybook-package-route-directories"

describe.each([
  {name: "Каталог с TSX входом", props: {entry: "index.tsx"}, expected: {entry: "tsx", module: true}},
  {name: "Каталог с TS входом", props: {entry: "index.ts"}, expected: {entry: "ts", module: false}},
])("$name", async ({props, expected}) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-directories-scenario-")))
  afterAll(() => rm(root, {recursive: true, force: true}))
  await mkdir(join(root, "controls"))
  await mkdir(join(root, "src"))
  await writeFile(join(root, "controls", props.entry), "export const example = true\n")

  const result = await readDirectories({root, parent: root, repository: null})

  test("Непосредственный публичный каталог", () => {
    expect(result.directories, "Видимый ребёнок получает физический путь и тип ближайшей module boundary")
      .toEqual([{name: "controls", path: join(root, "controls"), ...expected}])
  })

  test("Приватный каталог скрыт", () => {
    expect(result.directories.map(directory => directory.name), "Служебный src не входит в структурную навигацию")
      .not.toContain("src")
  })
})
