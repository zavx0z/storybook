import {afterAll, describe, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtemp, rm, symlink} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {readMcpContent} from "../src/content"

describe("Чтение исходного контракта", async () => {
  const root = await mkdtemp(join(tmpdir(), "storybook-mcp-content-"))
  afterAll(() => rm(root, {recursive: true, force: true}))
  const path = join(root, "input.ts")
  const source = '/** Исходный текст. */\nexport type Input = string\nthrow new Error("Исполнение запрещено")'
  await Bun.write(path, source)
  const input = {path, digest: createHash("sha256").update(source).digest("hex"), schema: {type: "string", description: "Исходный текст."}}

  test("Возвращается подготовленная схема; чтение ничего не исполняет", async () => {
    expect(await readMcpContent({input, scenarios: [path]})).toEqual({input: input.schema, scenarios: [source]})
  })

  test("Другая редакция контракта не выдаётся за проверенную", async () => {
    await expect(readMcpContent({input: {...input, digest: "previous"}})).rejects.toThrow("Контракт изменился")
  })

  test("Подмена исходника ссылкой отклоняется", async () => {
    const link = join(root, "linked.ts")
    await symlink(path, link)
    await expect(readMcpContent({input: {...input, path: link}})).rejects.toThrow()
  })
})
