/** Проверяет единственных физических владельцев самостоятельных предметных областей. */
import {expect, test} from "bun:test"
import {resolve} from "node:path"
import readPackage from "@archetypes/package"

test("предметные области принадлежат Repo без промежуточного Archetypes", async () => {
  const root = resolve(import.meta.dir, "../../..")
  const result = await readPackage({path: root})
  const expected = [
    ["cluster", "@archetypes/cluster"],
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

test("разделы технологий не создают фасадных владельцев самостоятельных возможностей", async () => {
  const root = resolve(import.meta.dir, "../../..")
  const result = await readPackage({path: root})
  const facades = ["@storybook/tech", "@tech/build", "@tech/process", "@tech/hmr", "@tech/mcp", "@tech/http", "@tech/testing"]
  expect(result.packages.filter(item => facades.includes(item.name)),
    "Каталог без собственной реализации или общего протокола не получает отдельную package identity").toEqual([])
  for (const [directory, name] of [
    ["tech/build/compiler", "@build/compiler"],
    ["tech/hmr/page", "@hmr/page"],
    ["tech/http/client", "@http/client"],
    ["tech/mcp/stdio", "@mcp/stdio"],
    ["tech/process/wait", "@process/wait"],
    ["tech/testing/browser-root", "@web/browser-fixture"],
  ] as const) {
    expect(result.packages.find(item => item.name === name),
      "Реальная возможность сохраняет identity, исходники и прямого предметного владельца")
      .toEqual({name, path: resolve(root, directory), parent: root})
  }
})
