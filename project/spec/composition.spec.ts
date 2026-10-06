import {describe, expect, test} from "bun:test"
import {mkdir, readFile, writeFile} from "node:fs/promises"
import {resolve} from "node:path"
import readProject from "@zavx0z/storybook-project"
import {createProjectFixture, git} from "./fixture"

describe("Изменение состава Project", () => {
  test("Каждое чтение раскрывает текущий package.json", async () => {
    const fixture = await createProjectFixture([
      {key: "first", path: "sources/first", name: "@fixture/first"},
      {key: "second", path: "sources/second", name: "@fixture/second"},
    ])
    try {
      const before = await readProject(fixture.props)
      const manifest = JSON.parse(await readFile(resolve(fixture.root, "package.json"), "utf8"))
      delete manifest.dependencies.first
      await writeFile(resolve(fixture.root, "package.json"), JSON.stringify(manifest))
      const after = await readProject(fixture.props)
      expect(before.repositories.map(repo => repo.name), "Исходный состав включает оба объявленных Repo")
        .toEqual(["@fixture/first", "@fixture/second"])
      expect(after.repositories.map(repo => repo.name), "Исключённая dependency исчезает при следующем чтении без скрытого реестра")
        .toEqual(["@fixture/second"])
      expect(await Bun.file(resolve(fixture.directory, "sources/first/package.json")).exists(), "Чтение не удаляет исходники исключённого Repo")
        .toBeTrue()
    } finally {
      await fixture.cleanup()
    }
  })

  test("Соседний Git-корень без зависимости не участвует", async () => {
    const fixture = await createProjectFixture([])
    try {
      const neighbor = resolve(fixture.root, "unlisted")
      await mkdir(neighbor)
      await git(neighbor, ["init", "--quiet"])
      await writeFile(resolve(neighbor, "package.json"), JSON.stringify({name: "@fixture/unlisted"}))
      const result = await readProject(fixture.props)
      expect(result.dependencies, "Repo на диске не становится участником без объявления в package.json Project")
        .toEqual([])
      expect(result.repositories, "Неверный .gitmodules и соседний Git-корень не подменяют состав dependencies")
        .toEqual([])
    } finally {
      await fixture.cleanup()
    }
  })

  test("Повторный ключ dependencies и devDependencies", async () => {
    const fixture = await createProjectFixture([{key: "library", path: "unused", name: "library", installed: true}])
    try {
      const manifest = JSON.parse(await readFile(resolve(fixture.root, "package.json"), "utf8"))
      manifest.devDependencies.library = "*"
      manifest.peerDependencies = {"absent-peer": "*"}
      manifest.optionalDependencies = {"absent-optional": "*"}
      await writeFile(resolve(fixture.root, "package.json"), JSON.stringify(manifest))
      const result = await readProject(fixture.props)
      expect(result.dependencies, "Один объявленный пакет участвует один раз; peer и optional не добавляют обязательных участников")
        .toEqual([{root: resolve(fixture.root, "node_modules/library"), name: "library", repository: null}])
    } finally {
      await fixture.cleanup()
    }
  })
})
