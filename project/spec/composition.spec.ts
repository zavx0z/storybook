import {describe, expect, test} from "bun:test"
import {mkdir, writeFile} from "node:fs/promises"
import {resolve} from "node:path"
import readProject from "@archetypes/project"
import {createProjectFixture, git} from "./fixture"

describe("Изменение состава Project", () => {
  test("Каждое чтение раскрывает текущее .gitmodules", async () => {
    const fixture = await createProjectFixture([
      {section: "first", path: "source", name: "@fixture/first"},
      {section: "second", path: "other", name: "@fixture/second"},
    ])
    try {
      const before = await readProject({path: fixture.root})
      await git(fixture.root, ["config", "--file", ".gitmodules", "--remove-section", "submodule.first"])
      const after = await readProject({path: fixture.root})
      expect(before.repositories.map(repo => repo.name), "Исходный состав включает оба объявленных Repo")
        .toEqual(["@fixture/first", "@fixture/second"])
      expect(after.repositories.map(repo => repo.name), "Убранное объявление исчезает при следующем чтении без скрытого реестра")
        .toEqual(["@fixture/second"])
      expect(await Bun.file(resolve(fixture.root, "source/package.json")).exists(), "Чтение не удаляет исходники исключённого Repo")
        .toBeTrue()
    } finally {
      await fixture.cleanup()
    }
  })

  test("Соседний Git-корень без объявления не участвует", async () => {
    const fixture = await createProjectFixture([])
    try {
      const neighbor = resolve(fixture.root, "unlisted")
      await mkdir(neighbor)
      await git(neighbor, ["init", "--quiet"])
      await writeFile(resolve(neighbor, "package.json"), JSON.stringify({name: "@fixture/unlisted"}))
      const result = await readProject({path: fixture.root})
      expect(result.repositories, "Обнаруженный на диске Repo не становится участником без собственного объявления в .gitmodules")
        .toEqual([])
    } finally {
      await fixture.cleanup()
    }
  })
})
