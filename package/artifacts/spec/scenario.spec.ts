import {afterAll, describe, expect, test} from "bun:test"
import {mkdtempSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import collectArtifacts from "@package/artifacts"

describe.each([
  {name: "Прерванный кандидат", props: {published: false}, remaining: []},
  {name: "Применённая ревизия", props: {published: true}, remaining: ["applied.json", "revision-a"]},
])("$name", ({props, remaining}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "storybook-artifacts-scenario-")))
  afterAll(() => rmSync(root, {recursive: true, force: true}))
  const packagePath = join(root, "button")
  mkdirSync(join(packagePath, "revision-a"), {recursive: true})
  mkdirSync(join(packagePath, "revision-b"))
  if (props.published) writeFileSync(join(packagePath, "applied.json"), JSON.stringify({version: 1, revision: "revision-a"}))

  collectArtifacts(root)

  test("Состав после восстановления", () => {
    expect(readdirSync(root), "Кандидат без применения удаляется; опубликованная ревизия и её свидетельство сохраняются")
      .toEqual(props.published ? ["button"] : [])
    if (props.published) {
      expect(readdirSync(packagePath).sort(), "Прерванная следующая ревизия не остаётся рядом с применённой")
        .toEqual([...remaining])
    }
  })
})
