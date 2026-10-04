import {describe, expect, test} from "bun:test"
import {mkdir, rm, symlink, writeFile} from "node:fs/promises"
import {resolve} from "node:path"
import readProject from "@storybook/project"
import {createProjectFixture, git} from "./fixture"

describe("Ошибки чтения Project", () => {
  test("Неверный корневой манифест участника", async () => {
    const fixture = await createProjectFixture([{section: "broken", path: "repo", name: "@fixture/repo"}])
    try {
      await writeFile(resolve(fixture.root, "repo/package.json"), "{")
      await expect(readProject({path: fixture.root}), "Нераскрытое собственное имя Repo прерывает чтение состава с адресом участника")
        .rejects.toThrow("Не удалось прочитать имя Repo submodule broken")
    } finally {
      await fixture.cleanup()
    }
  })

  test.each([
    {name: "Отсутствующее имя", manifest: {label: "Подпись"}},
    {name: "Нестроковое имя", manifest: {name: 42}},
    {name: "Пустое имя", manifest: {name: "  "}},
  ])("$name", async ({manifest}) => {
    const fixture = await createProjectFixture([])
    try {
      await writeFile(resolve(fixture.root, "package.json"), JSON.stringify(manifest))
      await expect(readProject({path: fixture.root}), "Имя Project не восстанавливается из label или имени директории")
        .rejects.toBeInstanceOf(TypeError)
    } finally {
      await fixture.cleanup()
    }
  })

  test.each([
    {name: "Абсолютный путь", path: "/outside-project"},
    {name: "Родительский путь", path: "../outside-project"},
    {name: "Корень самого Project", path: "."},
    {name: "Пустой путь", path: ""},
  ])("$name", async ({path}) => {
    const fixture = await createProjectFixture([])
    try {
      await git(fixture.root, ["config", "--file", ".gitmodules", "submodule.invalid.path", path])
      await expect(readProject({path: fixture.root}), "Repo имеет отдельный относительный корень внутри Project")
        .rejects.toBeInstanceOf(TypeError)
    } finally {
      await fixture.cleanup()
    }
  })

  test("Неинициализированный участник", async () => {
    const fixture = await createProjectFixture([])
    try {
      await git(fixture.root, ["config", "--file", ".gitmodules", "submodule.uninitialized.path", "missing"])
      await expect(readProject({path: fixture.root}), "Отсутствующий Repo не исчезает молча из состава")
        .rejects.toThrow("Submodule uninitialized недоступен по пути missing")
    } finally {
      await fixture.cleanup()
    }
  })

  test("Участник без собственной Git-границы", async () => {
    const fixture = await createProjectFixture([{section: "plain", path: "plain", name: "@fixture/plain"}])
    try {
      await rm(resolve(fixture.root, "plain/.git"), {recursive: true})
      await expect(readProject({path: fixture.root}), "Пакет, унаследовавший Git-корень Project, не является участвующим Repo")
        .rejects.toThrow("не имеет собственной Git-границы")
    } finally {
      await fixture.cleanup()
    }
  })

  test("Повторный физический Repo", async () => {
    const fixture = await createProjectFixture([{section: "first", path: "repo", name: "@fixture/repo"}])
    try {
      await symlink(resolve(fixture.root, "repo"), resolve(fixture.root, "alias"))
      await git(fixture.root, ["config", "--file", ".gitmodules", "submodule.second.path", "alias"])
      await expect(readProject({path: fixture.root}), "Два объявления одного канонического Repo дают ошибку вместо скрытой дедупликации")
        .rejects.toThrow("повторяет физический Repo")
    } finally {
      await fixture.cleanup()
    }
  })

  test("Ссылка на внешний физический Repo", async () => {
    const fixture = await createProjectFixture([])
    const outside = await createProjectFixture([])
    try {
      await symlink(outside.root, resolve(fixture.root, "outside"))
      await git(fixture.root, ["config", "--file", ".gitmodules", "submodule.external.path", "outside"])
      await expect(readProject({path: fixture.root}), "Относительная ссылка не обходит физическую границу Project")
        .rejects.toThrow("физический корень вне Project")
    } finally {
      await Promise.all([fixture.cleanup(), outside.cleanup()])
    }
  })

  test.each([
    {name: "Отсутствующий path", config: '[submodule "missing"]\nurl = https://example.invalid/repo.git\n', message: "ровно один непустой path"},
    {name: "Несколько path в одной секции", config: '[submodule "repeated"]\npath = one\npath = two\n', message: "ровно один непустой path"},
    {name: "Неверный синтаксис", config: '[submodule "broken"\npath = one\n', message: "Не удалось прочитать .gitmodules"},
  ])("$name", async ({config, message}) => {
    const fixture = await createProjectFixture([])
    try {
      await writeFile(resolve(fixture.root, ".gitmodules"), config)
      await expect(readProject({path: fixture.root}), "Неверное объявление состава не превращается в пустой успешный Project")
        .rejects.toThrow(message)
    } finally {
      await fixture.cleanup()
    }
  })

  test("Вложенный каталог вместо корня Project", async () => {
    const fixture = await createProjectFixture([])
    try {
      const nested = resolve(fixture.root, "nested")
      await mkdir(nested)
      await writeFile(resolve(nested, "package.json"), JSON.stringify({name: "@fixture/nested"}))
      await expect(readProject({path: nested}), "Произвольный пакет внутри Git-дерева не заменяет точный корень Project")
        .rejects.toThrow("не является точным Git-корнем")
    } finally {
      await fixture.cleanup()
    }
  })
})
