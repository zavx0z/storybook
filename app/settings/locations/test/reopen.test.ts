import {expect, test} from "bun:test"
import {mkdtemp, mkdir, readFile, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createLocations from "@zavx0z/storybook-app-settings-locations"

test("Сохранение переживает повторное открытие и не переносит файлы", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "zavx0z-locations-reopen-")))
  try {
    await mkdir(join(home, "repos"))
    await mkdir(join(home, "projects"))
    const marker = join(home, "repos/source.txt")
    await writeFile(marker, "исходник")
    const expected = {repositoriesDirectory: join(home, "repos"), projectsDirectory: join(home, "projects")}
    await createLocations({home}).update({repositoriesDirectory: "~/repos", projectsDirectory: "~/projects"})
    expect(await createLocations({home}).read(), "Новый экземпляр читает сохранённые канонические пути").toEqual(expected)
    expect(await readFile(marker, "utf8"), "Повторное открытие сохраняет исходник в выбранном каталоге").toBe("исходник")
    expect(JSON.parse(await readFile(join(home, ".zavx0z/config.json"), "utf8")), "Сохранённый файл содержит оба выбранных пути").toEqual(expected)
  } finally {
    await rm(home, {recursive: true, force: true})
  }
})
