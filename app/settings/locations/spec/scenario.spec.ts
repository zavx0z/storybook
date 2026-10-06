import {afterAll, describe, expect, test} from "bun:test"
import {lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createLocations from "@zavx0z/storybook-app-settings-locations"

describe.each([
  {name: "Первый запуск", directoryExists: false, existingConfig: false, concurrent: false, update: false},
  {name: "Пустой каталог настроек", directoryExists: true, existingConfig: false, concurrent: false, update: false},
  {name: "Существующий конфиг", directoryExists: true, existingConfig: true, concurrent: false, update: false},
  {name: "Одновременный первый запуск", directoryExists: false, existingConfig: false, concurrent: true, update: false},
  {name: "Сохранение выбранных каталогов", directoryExists: false, existingConfig: false, concurrent: false, update: true},
])("$name", async ({directoryExists, existingConfig, concurrent, update}) => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "zavx0z-locations-")))
  afterAll(() => rm(home, {recursive: true, force: true}))
  await mkdir(join(home, "repos"))
  await mkdir(join(home, "projects"))
  const marker = join(home, "repos/source.txt")
  await writeFile(marker, "исходник")
  const directory = join(home, ".zavx0z")
  const file = join(directory, "config.json")
  const existing = {repositoriesDirectory: join(home, "repos"), extra: {theme: "dark"}}
  const content = `  ${JSON.stringify(existing)}\n`
  if (directoryExists) await mkdir(directory)
  if (existingConfig) await writeFile(file, content)
  const props = {home}
  const settings = createLocations(props)
  const expected = {
    repositoriesDirectory: existingConfig || update ? join(home, "repos") : null,
    projectsDirectory: update ? join(home, "projects") : null,
  }
  if (update) await settings.update({repositoriesDirectory: "~/repos", projectsDirectory: "~/projects"})
  const results = await Promise.all(Array.from({length: concurrent ? 24 : 1}, () => settings.read()))
  const saved = await readFile(file, "utf8")

  test("Пользовательские пути", () => {
    expect(results, "Каждое чтение получает полный конфиг; незаданные пути остаются null")
      .toEqual(Array.from({length: concurrent ? 24 : 1}, () => expected))
  })
  test("Состав конфига", () => {
    expect(JSON.parse(saved), "Создание сохраняет оба пути, чтение существующего файла сохраняет дополнительные данные")
      .toEqual(existingConfig ? existing : expected)
  })
  test("Повторное чтение", async () => {
    expect(await settings.read(), "Повторное чтение возвращает тот же выбор пользователя").toEqual(expected)
    expect(await readFile(file, "utf8"), "Повторное чтение сохраняет файл побайтно").toBe(saved)
  })
  test("Завершение записи", async () => {
    expect(await readdir(directory), "После публикации остаётся только готовый config.json").toEqual(["config.json"])
  })
  test("Сохранность исходников", async () => {
    expect(await readFile(marker, "utf8"), "Настройка расположения не переносит и не изменяет исходники").toBe("исходник")
  })

  /** @remarks Побайтная сохранность чужих полей раскрывается только для уже существующего файла. */
  describe.skipIf(!existingConfig)("Существующие данные", () => {
    test("Исходный документ", () => {
      expect(saved, "Чтение сохраняет дополнительные поля и форматирование существующего конфига").toBe(content)
    })
  })

  /** @remarks Права создания применимы только к каталогу, созданному этим запуском. */
  describe.skipIf(directoryExists)("Доступ пользователя", () => {
    test("Каталог настроек", async () => {
      expect((await lstat(directory)).mode & 0o777, "Новый каталог настроек доступен только пользователю").toBe(0o700)
    })
    test("Файл конфига", async () => {
      expect((await lstat(file)).mode & 0o777, "Новый конфиг доступен только пользователю").toBe(0o600)
    })
  })
})
