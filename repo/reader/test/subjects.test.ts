/** Проверяет единственных физических владельцев самостоятельных предметных областей. */
import {expect, test} from "bun:test"
import {resolve} from "node:path"
import readPackage from "@archetypes/package"

test("предметные области принадлежат Repo без промежуточного Archetypes", async () => {
  const root = resolve(import.meta.dir, "../../..")
  const result = await readPackage({path: root})
  const expected = [
    ["component", "@archetypes/component"],
    ["container", "@archetypes/container"],
    ["contracts", "@archetypes/contracts"],
    ["domain", "@archetypes/domain"],
    ["package", "@storybook/package"],
    ["project", "@archetypes/project"],
    ["repo", "@storybook/repo"],
    ["specs", "@archetypes/specs"],
    ["typedoc", "@archetypes/typedoc"],
  ] as const
  for (const [directory, name] of expected) {
    expect(result.packages.filter(item => item.name === name), "Перенос сохраняет единственную identity и прямую принадлежность Repo")
      .toEqual([{name, path: resolve(root, directory), parent: root}])
  }
  expect(result.packages.some(item => item.name === "@storybook/archetypes"), "Выведенный из использования контейнер не сохраняет публичного двойника").toBeFalse()
})
