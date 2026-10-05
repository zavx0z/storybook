import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createTools from "@zavx0z/storybook-app-environment-tools"

describe.each([
  {name: "Project", type: "Project" as const},
  {name: "Component", type: "Component" as const},
  {name: "Repo", type: "Repo" as const},
])("$name", async ({type}) => {
  const directory = await mkdtemp(join(tmpdir(), "entity-tools-example-"))
  afterAll(() => rm(directory, {recursive: true, force: true}))
  await writeFile(join(directory, "example.txt"), "Назначенная область")
  const tools = createTools({directory, type})
  const result = await tools.call({name: "filesystem.read", arguments: {path: "example.txt"}})

  test("Чтение", () => {
    expect(result, "Каждая сущность использует общий файловый инструмент Package в назначенной директории")
      .toMatchObject({content: "Назначенная область", path: "example.txt"})
  })
  test("Предметный состав", () => {
    expect(tools.list().some(tool => tool.name === "git.status"),
      "Дополнительный Git-инструмент объявляет только подтверждённый Repo").toBe(type === "Repo")
  })
})
