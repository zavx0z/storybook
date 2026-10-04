/** Проверяет единственных физических владельцев самостоятельных предметных областей. */
import {expect, test} from "bun:test"
import {resolve} from "node:path"
import readPackage from "@storybook-package/reader"

test("предметные области принадлежат Repo без промежуточного Archetypes", async () => {
  const root = resolve(import.meta.dir, "../../..")
  const result = await readPackage({path: root})
  const expected = [
    ["cluster", "@storybook/cluster"],
    ["component", "@storybook/component"],
    ["container", "@storybook/container"],
    ["contracts", "@storybook/contracts"],
    ["domain", "@storybook/domain"],
    ["project", "@storybook/project"],
    ["typedoc", "@storybook/typedoc"],
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
    ["tech/build/compiler", "@storybook-tech-build/compiler"],
    ["tech/hmr/page", "@storybook-tech-hmr/page"],
    ["tech/http/client", "@storybook-tech-http/client"],
    ["tech/mcp/stdio", "@storybook-tech-mcp/stdio"],
    ["tech/process/wait", "@storybook-tech-process/wait"],
    ["tech/testing/browser-root", "@storybook-tech-testing/browser-root"],
  ] as const) {
    expect(result.packages.find(item => item.name === name),
      "Реальная возможность сохраняет identity, исходники и прямого предметного владельца")
      .toEqual({name, path: resolve(root, directory), parent: root})
  }
})


test("предметный раздел не подменяет протокол самостоятельных операций", async () => {
  const root = resolve(import.meta.dir, "../../..")
  const result = await readPackage({path: root})
  const facades = ["@storybook/repo", "@storybook/specs", "@storybook/package", "@storybook-package/build", "@storybook-package/route"]
  expect(result.packages.filter(item => facades.includes(item.name)),
    "Общее название раздела не создаёт одну сущность Domain или общий протокол Cluster").toEqual([])
  for (const [directory, name] of [
    ["repo/reader", "@storybook-repo/reader"],
    ["repo/discovery", "@storybook-repo/discovery"],
    ["specs/reader", "@storybook-specs/reader"],
    ["package/graph", "@storybook-package/graph"],
    ["package/build/prepare", "@storybook-package-build/prepare"],
    ["package/route/resolve", "@storybook-package-route/resolve"],
  ] as const) {
    expect(result.packages.find(item => item.name === name),
      "Самостоятельная возможность остаётся доступной по своему имени и принадлежит Repo")
      .toEqual({name, path: resolve(root, directory), parent: root})
  }
})
