/** Проверяет единственных физических владельцев самостоятельных предметных областей. */
import {expect, test} from "bun:test"
import {resolve} from "node:path"
import readPackage from "@zavx0z/storybook-package-reader"

test("предметные области принадлежат Repo без промежуточного Archetypes", async () => {
  const root = resolve(import.meta.dir, "../../..")
  const result = await readPackage({path: root})
  const expected = [
    ["cluster", "@zavx0z/storybook-cluster"],
    ["component", "@zavx0z/storybook-component"],
    ["container", "@zavx0z/storybook-container"],
    ["contracts", "@zavx0z/storybook-contracts"],
    ["domain", "@zavx0z/storybook-domain"],
    ["project", "@zavx0z/storybook-project"],
    ["typedoc", "@zavx0z/storybook-typedoc"],
  ] as const
  for (const [directory, name] of expected) {
    expect(result.packages.filter(item => item.name === name), "Перенос сохраняет единственную identity и прямую принадлежность Repo")
      .toEqual([{name, path: resolve(root, directory), parent: root}])
  }
  expect(result.packages.some(item => item.name === "@zavx0z/storybook-archetypes"), "Выведенный из использования контейнер не сохраняет публичного двойника").toBeFalse()
})

test("разделы технологий не создают фасадных владельцев самостоятельных возможностей", async () => {
  const root = resolve(import.meta.dir, "../../..")
  const result = await readPackage({path: root})
  const facades = ["@zavx0z/storybook-tech", "@zavx0z/storybook-tech-build", "@zavx0z/storybook-tech-process", "@zavx0z/storybook-tech-hmr", "@zavx0z/storybook-tech-mcp", "@zavx0z/storybook-tech-http", "@zavx0z/storybook-tech-testing"]
  expect(result.packages.filter(item => facades.includes(item.name)),
    "Каталог без собственной реализации или общего протокола не получает отдельную package identity").toEqual([])
  for (const [directory, name] of [
    ["tech/build/compiler", "@zavx0z/storybook-tech-build-compiler"],
    ["tech/hmr/page", "@zavx0z/storybook-tech-hmr-page"],
    ["tech/http/client", "@zavx0z/storybook-tech-http-client"],
    ["tech/mcp/stdio", "@zavx0z/storybook-tech-mcp-stdio"],
    ["tech/process/wait", "@zavx0z/storybook-tech-process-wait"],
    ["tech/testing/browser-root", "@zavx0z/storybook-tech-testing-browser-root"],
  ] as const) {
    expect(result.packages.find(item => item.name === name),
      "Реальная возможность сохраняет identity, исходники и прямого предметного владельца")
      .toEqual({name, path: resolve(root, directory), parent: root})
  }
})


test("предметный раздел не подменяет протокол самостоятельных операций", async () => {
  const root = resolve(import.meta.dir, "../../..")
  const result = await readPackage({path: root})
  const facades = ["@zavx0z/storybook-repo", "@zavx0z/storybook-specs", "@zavx0z/storybook-package", "@zavx0z/storybook-package-build", "@zavx0z/storybook-package-route"]
  expect(result.packages.filter(item => facades.includes(item.name)),
    "Общее название раздела не создаёт одну сущность Domain или общий протокол Cluster").toEqual([])
  for (const [directory, name] of [
    ["repo/reader", "@zavx0z/storybook-repo-reader"],
    ["repo/discovery", "@zavx0z/storybook-repo-discovery"],
    ["specs/reader", "@zavx0z/storybook-specs-reader"],
    ["package/graph", "@zavx0z/storybook-package-graph"],
    ["package/build/prepare", "@zavx0z/storybook-package-build-prepare"],
    ["package/route/resolve", "@zavx0z/storybook-package-route-resolve"],
  ] as const) {
    expect(result.packages.find(item => item.name === name),
      "Самостоятельная возможность остаётся доступной по своему имени и принадлежит Repo")
      .toEqual({name, path: resolve(root, directory), parent: root})
  }
})
