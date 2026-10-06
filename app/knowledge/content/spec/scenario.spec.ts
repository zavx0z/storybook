import {afterAll, describe, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {mkdtemp, rm, writeFile} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import readContent from "@zavx0z/storybook-app-knowledge-content"

describe.each([{name: "Контракт с примером", props: {text: 'export type Input = string\nthrow new Error("Не исполнять")\n'}}])("$name", async ({props}) => {
  const root = await mkdtemp(join(tmpdir(), "mcp-content-scenario-"))
  afterAll(() => rm(root, {recursive: true, force: true}))
  const path = join(root, "input.ts")
  await writeFile(path, props.text)
  const result = await readContent({input: {path, digest: createHash("sha256").update(props.text).digest("hex"), schema: {type: "string"}}, scenarios: [path]})
  test("Готовые сведения", () => {
    expect(result, "Схема сохраняет форму контракта, пример передаётся текстом без исполнения")
      .toEqual({input: {type: "string"}, scenarios: [props.text]})
  })
})
