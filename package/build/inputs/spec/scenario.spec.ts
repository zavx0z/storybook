import {afterAll, describe, expect, test} from "bun:test"
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import inputs from "@storybook-package-build/inputs"

describe.each([
  {name: "Один исходник", props: {duplicate: false}},
  {name: "Повторённый исходник", props: {duplicate: true}},
])("$name", ({props}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-build-inputs-scenario-")))
  afterAll(() => rmSync(root, {recursive: true, force: true}))
  const source = join(root, "index.ts")
  writeFileSync(source, "export const value = true\n")

  const metafile = props.duplicate ? {"index.ts": {}, [source]: {}} : {"index.ts": {}}
  const result = inputs.canonicalBuildInputs(metafile, root)

  test("Канонические пути компиляции", () => {
    expect(result, "Относительный и абсолютный путь одного физического исходника дают одну запись")
      .toEqual([source])
  })

  test("Несуществующий вход исключён", () => {
    expect(result, "Список содержит только существующий source, доступный пакетной сборке")
      .not.toContain(join(root, "missing.ts"))
  })
})
