import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import scanConsumerBoundary from "@zavx0z/storybook-package-build-consumer-boundary"

describe.each([
  {name: "Независимый потребитель", props: {storybookDependency: false}, expected: []},
  {name: "Зависимость от Storybook", props: {storybookDependency: true}, expected: ["storybook-dependency"]},
])("$name", async ({props, expected}) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-consumer-scenario-")))
  afterAll(() => rm(root, {recursive: true, force: true}))
  await mkdir(join(root, "src"))
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "@fixture/consumer",
    ...(props.storybookDependency ? {devDependencies: {"@zavx0z/storybook": "latest"}} : {}),
  }))
  await writeFile(join(root, "src/index.ts"), "export const consumer = true\n")

  const result = scanConsumerBoundary([root])

  test("Граница внешнего инструмента", () => {
    expect(result.map(violation => violation.kind), "Потребитель остаётся независимым от внешнего Storybook; объявленная зависимость диагностируется")
      .toEqual([...expected])
  })

  test("Путь диагностики", () => {
    expect(result.map(violation => violation.path), "Нарушение указывает на принадлежащий потребителю manifest")
      .toEqual(props.storybookDependency ? ["package.json"] : [])
  })
})
