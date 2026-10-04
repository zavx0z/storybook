/**
Показывает происхождение общего протокола и расширений участника без исполнения.

@packageDocumentation
*/
import {afterAll, describe, expect, test} from "bun:test"
import {rm} from "node:fs/promises"
import {resolve} from "node:path"
import readCluster from "@zavx0z/storybook-cluster"
import {prepareClusterExample} from "./prepare"

const root = await prepareClusterExample()

describe.each([{name: "Группа числовых операций", props: {path: resolve(root, "group")}}])("$name", async ({props}) => {
  afterAll(() => rm(root, {recursive: true, force: true}))
  const result = await readCluster(props)
  test("Самостоятельный участник", () => {
    expect(result.members, "Реэкспорт сохраняет исходного владельца реализации")
      .toEqual([{name: "@fixture/increment", path: resolve(props.path, "increment")}])
  })
  test("Общий протокол", () => {
    expect(result.protocols.extensions[0]?.base.owner?.name, "Общее соглашение принадлежит группе").toBe("@fixture/group")
    expect(result.protocols.extensions[0]?.roles, "Участник сохраняет исходные общие роли и их типовую совместимость").toEqual([
      {name: "Input", linked: true, compatible: true},
      {name: "Output", linked: true, compatible: true},
    ])
    expect(result.protocols.diagnostics, "Без Git Repo имена не считаются проверенными; протоколы и их связи доступны")
      .toEqual(["FixtureGroup", "FixtureIncrement"].map((name, index) => ({
        severity: "warning" as const,
        code: "namespace-name-context",
        path: resolve(props.path, index === 0 ? "contract/index.ts" : "increment/contract/index.ts"),
        message: `Имя namespace ${name} не проверено: Git-граница Repo исходного владельца не установлена`,
      })))
  })
})
