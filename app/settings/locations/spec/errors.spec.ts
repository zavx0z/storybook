import {expect, test} from "bun:test"
import {mkdtemp, mkdir, readFile, realpath, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createLocations from "@zavx0z/storybook-app-settings-locations"

test("Отказ проверки сохраняет прежний конфиг", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "zavx0z-locations-error-")))
  try {
    await mkdir(join(home, "repos"))
    await mkdir(join(home, "projects"))
    const settings = createLocations({home})
    const expected = {repositoriesDirectory: join(home, "repos"), projectsDirectory: join(home, "projects")}
    await settings.update(expected)
    const saved = await readFile(join(home, ".zavx0z/config.json"), "utf8")
    await expect(settings.update({repositoriesDirectory: join(home, "missing"), projectsDirectory: join(home, "projects")}),
      "Отсутствующий каталог отклоняется до изменения конфигурации").rejects.toThrow()
    expect(await settings.read(), "Ошибка нового выбора сохраняет ранее выбранные пути").toEqual(expected)
    expect(await readFile(join(home, ".zavx0z/config.json"), "utf8"), "Отказ проверки оставляет существующий файл побайтно неизменным").toBe(saved)
  } finally {
    await rm(home, {recursive: true, force: true})
  }
})
