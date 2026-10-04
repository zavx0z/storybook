/** Пакет самостоятельно обновляет свои сведения; вложенные владельцы сохраняются отдельно. */
import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import PackageMetadata from "@zavx0z/storybook-package-metadata"

describe.each([
  {name: "Самостоятельный пакет", props: {nested: false, selectChild: false}},
  {name: "Пакет с вложенным владельцем", props: {nested: true, selectChild: false}},
  {name: "Вложенный пакет отдельно", props: {nested: true, selectChild: true}},
])("$name", async ({props}) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-package-metadata-")))
  afterAll(() => rm(root, {recursive: true, force: true}))
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/parent", workspaces: ["parts/*"]}))
  await writeFile(join(root, "index.ts"), "/** Сведения родителя.\n@packageDocumentation\n*/\nthrow new Error('Исходник не исполняется')\n")
  const child = join(root, "parts/child")
  if (props.nested) {
    await mkdir(child, {recursive: true})
    await writeFile(join(child, "package.json"), JSON.stringify({name: "@fixture/child"}))
    await writeFile(join(child, "index.ts"), "/** Сведения ребёнка.\n@packageDocumentation\n*/\nexport default 1\n")
  }
  const selected = props.selectChild ? child : root
  const metadata = new PackageMetadata(selected)
  const collected = await metadata.refresh()
  const own = collected.scopes.find(scope => scope.scopeRoot === selected)
  if (own?.kind !== "package") throw new Error("Сбор должен вернуть выбранный пакет")
  const saved = metadata.read()
  const reference = await metadata.save(saved)

  test("Собственные сведения", () => {
    expect(saved.moduleDocumentation?.markdown, "Пакет читает свой обзор без исполнения исходника").toBe(props.selectChild ? "Сведения ребёнка." : "Сведения родителя.")
    expect(saved, "Файловое чтение воспроизводит собранные сведения").toEqual(own)
  })
  test("Независимость от приложения", async () => {
    expect(await Bun.file(join(root, "meta/data/tree.json")).exists(), "Для чтения пакета дерево Project не создаётся").toBe(false)
    expect(metadata.read(reference.hash), "Чтение по отпечатку воспроизводит точную сохранённую версию").toEqual(saved)
    expect(reference.changed, "Повторная запись неизменного результата не переписывает файлы").toBe(0)
  })
  test("Вложенный состав", () => {
    expect(saved.packageIds, "Состав принадлежит любому пакету и содержит ссылки на вложенных владельцев")
      .toEqual(props.nested && !props.selectChild ? ["package:@fixture/child"] : [])
  })
  test("Граница выбранного поддерева", () => {
    expect(collected.scopes.map(scope => scope.id), "Сбор включает выбранного владельца и его потомков, сохраняя внешнего родителя за границей")
      .toEqual(props.selectChild ? ["@fixture/child"] : props.nested ? ["@fixture/parent", "@fixture/child"] : ["@fixture/parent"])
  })
})
