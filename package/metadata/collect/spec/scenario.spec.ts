/** Сбор сведений пакетов использует package.json и объявленный состав workspaces. */
import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import discoverStorybookPackages from "@zavx0z/storybook-package-metadata-collect"

const fixtureRoot = join(import.meta.dir, "../fixtures/valid")

describe.each([
  {name: "Repo с вложенными пакетами", props: {roots: [fixtureRoot], expected: ["package:fixture-workspace"]}},
  {name: "Repo и независимый пакет", props: {roots: [fixtureRoot, join(fixtureRoot, "standalone")], expected: ["package:fixture-workspace", "package:@fixture/standalone"]}},
  {name: "Workspace через директорию с src", props: {roots: [], marker: "src", expected: ["package:fixture-workspace"]}},
  {name: "Workspace через директорию с index.tsx", props: {roots: [], marker: "index.tsx", expected: ["package:fixture-workspace"]}},
])("$name", async ({props}) => {
  let roots = props.roots
  if (props.marker) {
    const root = await mkdtemp(join(tmpdir(), "storybook-metadata-scenario-"))
    afterAll(() => rm(root, {recursive: true, force: true}))
    await writeFile(join(root, "package.json"), JSON.stringify({name: "fixture-workspace", workspaces: ["features/**"]}))
    await mkdir(join(root, "features/group/components"), {recursive: true})
    await writeFile(join(root, "features/group/components/package.json"), JSON.stringify({name: "@fixture/components"}))
    if (props.marker === "src") await mkdir(join(root, "features/src"))
    else await writeFile(join(root, "features/index.tsx"), "export const value = 1\n")
    roots = [root]
  }
  const catalog = await discoverStorybookPackages(roots)

  test("Выбранные корни", () => {
    expect(catalog.rootIds, "Только явно подключённые корни становятся верхними узлами каталога").toEqual(props.expected)
  })
  test("Дочерние пакеты", () => {
    expect(catalog.scopes.map(scope => scope.canonicalId), "Workspaces раскрывает вложенные физические пакеты без отдельной декларации Storybook").toContain("package:@fixture/components")
  })
  test("Публикуемый состав", () => {
    expect(Object.isFrozen(catalog.scopes), "Результат одного обнаружения сохраняет неизменяемый снимок состава").toBeTrue()
  })

  /** @remarks Модульный маркер задан только в вариантах вложенной workspace-ветки. */
  describe.skipIf(!props.marker)("Физическая вложенность", () => {
    test("Промежуточные директории", () => {
      expect(catalog.scopes[0]?.directories?.map(directory => directory.relativePath),
        "src и index.tsx не убирают физические директории между Repo и объявленным workspace-пакетом")
        .toEqual(["features", "features/group"])
    })
  })
})
