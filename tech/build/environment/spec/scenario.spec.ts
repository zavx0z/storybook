/** Browser identity отделяет состав модулей платформы от смены host entry. */
import {describe, expect, test} from "bun:test"
import Environment from "@build/environment"

const hostEpoch = "a".repeat(64)
const sourcePath = "/fixture/shared.ts"

describe.each([
  {name: "Первый host entry", props: {entry: "/__storybook/shared/entries/package-a.js", moduleUrl: "/__storybook/shared/kernel/dom-a.js", epoch: "08e40fe383987c1e3088f1b3dbb938a637cd69ecd475ccdd62783b72317b45f1"}},
  {name: "Новый модуль платформы", props: {entry: "/__storybook/shared/entries/package-b.js", moduleUrl: "/__storybook/shared/kernel/dom-b.js", epoch: "c61301e15669e35e2fe9c22979a0096a5fc7646bebdfc48be01e91313f2c295a"}},
])("$name", ({props}) => {
  const modules = [{specifier: "@zavx0z/dom", sourcePath, url: props.moduleUrl}]
  const sourceFiles = [{path: sourcePath, contentDigest: "b".repeat(64)}]
  const identity = Environment.identity(props.entry, modules, hostEpoch, sourceFiles, false)

  test("Эпоха платформы", () => {
    expect(identity.epoch, "Fingerprint задан набором specifier и URL модулей; разные байты модуля меняют browser epoch").toBe(props.epoch)
  })
  test("Вход пакета", () => {
    expect(identity.packageEntryUrl, "Конкретный host entry сохраняется отдельно от эпохи общей платформы").toBe(props.entry)
  })
})
