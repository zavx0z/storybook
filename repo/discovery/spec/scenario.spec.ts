/** Discovery читает состав подключённого Repo из package.json и workspaces. */
import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import discoverStorybookPackages from "@zavx0z/storybook-repo-discovery"

const fixtureRoot = join(import.meta.dir, "../fixtures/valid")

describe.each([
  {name: "Repo с вложенными пакетами", props: {roots: [fixtureRoot], expected: ["package:fixture-workspace"]}},
  {name: "Repo и независимый пакет", props: {roots: [fixtureRoot, join(fixtureRoot, "standalone")], expected: ["package:fixture-workspace", "package:@fixture/standalone"]}},
])("$name", async ({props}) => {
  const catalog = await discoverStorybookPackages(props.roots)

  test("Выбранные корни", () => {
    expect(catalog.rootIds, "Только явно подключённые корни становятся верхними узлами каталога").toEqual(props.expected)
  })
  test("Дочерние пакеты", () => {
    expect(catalog.scopes.map(scope => scope.canonicalId), "Workspaces раскрывает вложенные физические пакеты без отдельной декларации Storybook").toContain("package:@fixture/components")
  })
  test("Публикуемый состав", () => {
    expect(Object.isFrozen(catalog.scopes), "Результат одного обнаружения сохраняет неизменяемый снимок состава").toBeTrue()
  })
})
