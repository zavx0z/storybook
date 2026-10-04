import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, mkdir, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import structure from "@storybook-package-route/structure"

describe.each([
  {name: "Сценарий и контракт", props: {scenarios: true}, expected: ["scenarios", "contract"]},
  {name: "Только контракт", props: {scenarios: false}, expected: ["contract"]},
])("$name", async ({props, expected}) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-structure-scenario-")))
  afterAll(() => rm(root, {recursive: true, force: true}))
  await writeFile(join(root, "package.json"), JSON.stringify({name: "@fixture/structure"}))
  await mkdir(join(root, "contract"))
  await writeFile(join(root, "contract/index.ts"), "export type Input = string\n")
  if (props.scenarios) {
    await mkdir(join(root, "spec"))
    await writeFile(join(root, "spec/scenario.spec.ts"), "export {}\n")
  }

  const views = await structure.readAvailableViews(root, root, true, true, null)

  test("Представления непосредственного владельца", () => {
    expect(views, "Доступные вкладки следуют существующим файлам сценария и контракта этого владельца")
      .toEqual(expected)
  })
})
