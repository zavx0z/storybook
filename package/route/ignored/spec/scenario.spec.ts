import {afterAll, describe, expect, test} from "bun:test"
import {mkdtemp, realpath, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import readIgnored from "@route/ignored"

describe.each([
  {name: "Без Git-репозитория", props: {git: false}},
  {name: "С правилами Git", props: {git: true}},
])("$name", async ({props}) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "storybook-ignored-scenario-")))
  afterAll(() => rm(root, {recursive: true, force: true}))
  const candidate = join(root, "hidden.txt")
  await writeFile(candidate, "fixture\n")
  if (props.git) {
    const init = Bun.spawn(["git", "init", "--quiet", root])
    if (await init.exited !== 0) throw new Error("Не удалось подготовить Git fixture")
    await writeFile(join(root, ".gitignore"), "hidden.txt\n")
  }

  const result = await readIgnored({root, paths: [candidate], repository: props.git ? root : null})

  test("Область проверки", () => {
    expect(result.repository, "Свидетельство видимости сохраняет использованный Git root")
      .toBe(props.git ? root : null)
  })

  test("Результат правил Git", () => {
    expect(result.ignored, "Native Git исключает файл только при наличии соответствующего правила")
      .toEqual(props.git ? [candidate] : [])
  })
})
