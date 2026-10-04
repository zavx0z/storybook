/**
Показывает происхождение общего протокола и расширений участника без исполнения.

@packageDocumentation
*/
import {afterAll, describe, expect, test} from "bun:test"
import {rm} from "node:fs/promises"
import {resolve} from "node:path"
import readCluster from "@storybook/cluster"
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
    expect(result.protocols.diagnostics, "Протоколы читаются без фиктивной реализации кластера").toEqual([])
  })
})
