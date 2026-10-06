import {describe, expect, test} from "bun:test"
import {mkdir, readFile, rm, writeFile} from "node:fs/promises"
import {resolve} from "node:path"
import readProject from "@zavx0z/storybook-project"
import {createProjectFixture} from "./fixture"

describe("Ошибки чтения Project", () => {
  test("Неверный манифест зависимости", async () => {
    const fixture = await createProjectFixture([{key: "broken", path: "sources/repo", name: "@fixture/repo"}])
    try {
      await writeFile(resolve(fixture.directory, "sources/repo/package.json"), "{")
      await expect(readProject(fixture.props), "Неверный манифест прерывает чтение с объявленным именем зависимости")
        .rejects.toThrow("Не удалось прочитать манифест зависимости broken")
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
      await expect(readProject(fixture.props), "Имя Project не восстанавливается из label или имени директории")
        .rejects.toBeInstanceOf(TypeError)
    } finally {
      await fixture.cleanup()
    }
  })

  test("Отсутствующая объявленная зависимость", async () => {
    const fixture = await createProjectFixture([{key: "missing", path: "sources/missing", name: "@fixture/missing"}])
    try {
      await rm(resolve(fixture.root, "node_modules/missing"))
      await expect(readProject(fixture.props), "Исходный Repo рядом с Project не заменяет отсутствующую установку declared dependency")
        .rejects.toThrow("Зависимость missing недоступна по пути")
    } finally {
      await fixture.cleanup()
    }
  })

  test.each(["../escape", "/absolute", "@scope/../escape", ".", ""])('Некорректный адрес "%s"', async key => {
    const fixture = await createProjectFixture([])
    try {
      const manifest = JSON.parse(await readFile(resolve(fixture.root, "package.json"), "utf8"))
      manifest.dependencies[key] = "*"
      await writeFile(resolve(fixture.root, "package.json"), JSON.stringify(manifest))
      await expect(readProject(fixture.props), "Ключ зависимости задаёт npm identity, а не файловый обход за node_modules")
        .rejects.toThrow("Некорректное имя зависимости Project")
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
      await expect(readProject({path: nested}), "Пакет внутри Git-дерева не заменяет точный корень Project")
        .rejects.toThrow("не является точным Git-корнем")
    } finally {
      await fixture.cleanup()
    }
  })
})
