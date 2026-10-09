import environment from "@zavx0z/storybook-package-env"
import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import createTools from "@zavx0z/storybook-app-environment-binding"
import createWorkspace from "@zavx0z/ai-workspace"

describe.each([
  {name: "Общая файловая область", extended: false},
  {name: "Предметное расширение", extended: true},
])("$name", async ({name, extended}) => {
  const directory = await mkdtemp(join(tmpdir(), "package-tools-example-"))
  afterAll(() => rm(directory, {recursive: true, force: true}))
  const workspace = createWorkspace({directory})
  const extension = {name: "example.summary", description: "Назначение примера",
    inputSchema: {type: "object", additionalProperties: false}, outputSchema: {type: "object"},
    annotations: {readOnlyHint: true, destructiveHint: false}, execute: () => ({description: "Пример"})}
  const tools = createTools({workspace, declaration: environment({directory}), extensions: extended ? [extension] : []})
  await tools.find(tool => tool.name === "filesystem.create")!.execute({path: "example.txt", content: "Пример"})
  const result = await tools.find(tool => tool.name === "filesystem.read")!.execute({path: "example.txt"})

  test("Исполнение общей возможности", () => {
    expect(result, "Инструмент читает созданный файл относительно назначенной области без HTTP AI")
      .toMatchObject({path: "example.txt", content: "Пример", truncated: false})
  })
  test("Состав", () => {
    expect(tools.length, "Сущность дополняет десять файловых инструментов, сохраняя их реализации").toBe(extended ? 11 : 10)
  })
  describe.skipIf(name !== "Предметное расширение")("Расширение сущности", () => {
    test("Предметный результат", async () => {
      expect(await tools.find(tool => tool.name === "example.summary")!.execute({}),
        "Дополнительная возможность возвращает собственный результат").toEqual({description: "Пример"})
    })
  })
})
