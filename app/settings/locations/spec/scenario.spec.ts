import {afterEach, expect, test} from "bun:test"
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createLocations from "../index"

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, {recursive: true, force: true}))) })
const fixture = async () => {
  const home = await mkdtemp(join(tmpdir(), "zavx0z-locations-"))
  homes.push(home)
  await mkdir(join(home, "repos"))
  await mkdir(join(home, "projects"))
  return {home, settings: createLocations({home})}
}

test("Первый запуск оставляет пути незаданными", async () => {
  const {settings} = await fixture()
  expect(await settings.read()).toEqual({repositoriesDirectory: null, projectsDirectory: null})
})

test("Сохранение переживает повторное открытие и не переносит файлы", async () => {
  const {home, settings} = await fixture()
  const marker = join(home, "repos/source.txt")
  await writeFile(marker, "исходник")
  const saved = await settings.update({repositoriesDirectory: "~/repos", projectsDirectory: "~/projects"})
  expect(await createLocations({home}).read()).toEqual(saved)
  expect(await readFile(marker, "utf8")).toBe("исходник")
  expect(JSON.parse(await readFile(join(home, ".zavx0z/config.json"), "utf8"))).toEqual(saved)
})

test("Отказ проверки сохраняет прежний конфиг", async () => {
  const {home, settings} = await fixture()
  const saved = await settings.update({repositoriesDirectory: join(home, "repos"), projectsDirectory: join(home, "projects")})
  await expect(settings.update({repositoriesDirectory: join(home, "missing"), projectsDirectory: join(home, "projects")})).rejects.toThrow()
  expect(await settings.read()).toEqual(saved)
})
