import {afterAll, describe, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import resources from "@package/resources"

describe.each([
  {name: "Локальная ссылка", props: {markdown: "[изображение](./media/preview.png)"}, allowAsset: true},
  {name: "Внешняя ссылка", props: {markdown: "[изображение](https://example.com/preview.png)"}, allowAsset: false},
])("$name", ({props, allowAsset}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-resources-scenario-")))
  afterAll(() => rmSync(root, {recursive: true, force: true}))
  mkdirSync(join(root, "media"))
  const source = join(root, "index.ts")
  const asset = join(root, "media/preview.png")
  writeFileSync(source, "/** Documentation. */\nexport default true\n")
  writeFileSync(asset, "image")

  const result = resources({ownerRoot: root, sourcePath: source, markdown: props.markdown})

  test("Точный исходник документации", () => {
    expect(result.resolveSourceFile(source), "Список разрешает только исходник владельца")
      .toBe(source)
  })

  test("Ресурс из текста", () => {
    expect(result.resolveAsset(asset), "Локальная ссылка открывает свой файл; внешний адрес не даёт права на соседний файл")
      .toBe(allowAsset ? asset : null)
  })
})
