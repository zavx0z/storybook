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
    ["project", "@archetypes/project"],
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


test("предметный раздел не подменяет протокол самостоятельных операций", async () => {
  const root = resolve(import.meta.dir, "../../..")
  const result = await readPackage({path: root})
  const facades = ["@storybook/repo", "@archetypes/specs", "@storybook/package", "@package/build", "@storybook/route"]
  expect(result.packages.filter(item => facades.includes(item.name)),
    "Общее название раздела не создаёт одну сущность Domain или общий протокол Cluster").toEqual([])
  for (const [directory, name] of [
    ["repo/reader", "@archetypes/repo"],
    ["repo/discovery", "@repo/discovery"],
    ["specs/reader", "@archetypes/spec-reader"],
    ["package/graph", "@package/graph"],
    ["package/build/prepare", "@package-build/prepare"],
    ["package/route/resolve", "@route/resolve"],
  ] as const) {
    expect(result.packages.find(item => item.name === name),
      "Самостоятельная возможность остаётся доступной по своему имени и принадлежит Repo")
      .toEqual({name, path: resolve(root, directory), parent: root})
  }
})
