/** Проверяет соответствие npm-имени реальной вложенности пакета в Repo. */
import {expect, test} from "bun:test"
import {mkdir, mkdtemp, realpath, rm} from "node:fs/promises"
import {basename, join, resolve} from "node:path"
import readScenario from "@zavx0z/storybook-specs-scenarios-reader"

const repo = resolve(import.meta.dir, "../../..")
const scenario = resolve(import.meta.dir, "../spec/scenario.spec.ts")

test.each([
  {label: "Полный путь родителей", variant: "complete", passed: true},
  {label: "Пропущен Repo", variant: "without-repo", passed: false},
  {label: "Пропущен предок", variant: "without-parent", passed: false},
  {label: "Переставлены предки", variant: "reordered", passed: false},
  {label: "Чужая организация", variant: "other-org", passed: false},
  {label: "Прежний scope из родителей", variant: "old-scope", passed: false},
  {label: "Другое локальное имя", variant: "other-name", passed: false},
])("$label", async ({variant, passed}) => {
  const temporary = join(repo, "tmp")
  await mkdir(temporary, {recursive: true})
  const root = await realpath(await mkdtemp(join(temporary, "name-path-")))
  try {
    const leaf = join(root, "grandparent", "parent", "leaf")
    const prefix = `${basename(repo)}-tmp-${basename(root)}`
    const expected = `@zavx0z/${prefix}-grandparent-parent-leaf`
    const names: Record<string, string> = {
      complete: expected,
      "other-org": `@other/${prefix}-grandparent-parent-leaf`,
      "old-scope": `@${prefix}-grandparent-parent/leaf`,
      "without-repo": `@zavx0z/tmp-${basename(root)}-grandparent-parent-leaf`,
      "without-parent": `@zavx0z/${prefix}-parent-leaf`,
      reordered: `@zavx0z/${prefix}-parent-grandparent-leaf`,
      "other-name": `@zavx0z/${prefix}-grandparent-parent-other`,
    }
    await Bun.write(join(leaf, "package.json"), JSON.stringify({
      name: names[variant],
      description: "Пример имени вложенного пакета",
      type: "module",
      exports: {".": "./index.ts"},
    }))
    await Bun.write(join(leaf, "index.ts"), "export default 1\n")
    const report = await readScenario({
      path: scenario,
      props: {path: leaf},
      testNamePattern: "Путь родителей в npm-имени",
    })
    expect(report.exitCode === 0, report.stderr).toBe(passed)
    expect(report.tests.find(point => point.label === "Путь родителей в npm-имени")?.status)
      .toBe(passed ? "passed" : "failed")
    const assertion = report.assertions.find(point => point.test === "Путь родителей в npm-имени")
    expect(assertion?.actual).toEqual({applicable: true, name: names[variant]!, inheritedName: expected})
  } finally {
    await rm(root, {recursive: true, force: true})
  }
}, 30_000)
