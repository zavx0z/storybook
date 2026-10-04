import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import prepareScenarios from "@zavx0z/storybook-package-build-scenarios"
import type {StorybookPackageSession} from "@zavx0z/storybook-package-session"

const source = resolve(import.meta.dir, "fixture/function/spec/scenario.spec.ts")

describe.each([
  {name: "Сценарий функции пакета", props: {nodeId: "package:@fixture/storybook-action"}},
])("$name", async ({props}) => {
  const descriptor = {
    scenarioSpecs: [{nodeId: props.nodeId, sourcePaths: [source]}],
  } as unknown as StorybookPackageSession.Input[0]
  const result = await prepareScenarios(descriptor, new AbortController().signal)

  test("Тип подготовленного представления", () => {
    expect(result.map(item => [item.kind, item.nodeId]), "Поддержанный функциональный сценарий становится data-only preview своего структурного узла")
      .toEqual([["function", props.nodeId]])
  })

  test("Авторские варианты", () => {
    expect(result[0]?.variants.map(variant => variant.title), "Подготовка сохраняет названия двух исполняемых вариантов")
      .toEqual(["Основное действие", "Другое действие"])
  })
})
