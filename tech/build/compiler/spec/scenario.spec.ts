/** Compiler выбирает точную цель условного экспорта для заданной среды. */
import {describe, expect, test} from "bun:test"
import Compiler from "@storybook-tech-build/compiler"

describe.each([
  {name: "Browser export", props: {declaration: {browser: "./browser.ts", default: "./index.ts"}, conditions: ["browser"], expected: "./browser.ts"}},
  {name: "Server export", props: {declaration: {browser: "./browser.ts", default: "./index.ts"}, conditions: ["node"], expected: "./index.ts"}},
])("$name", ({props}) => {
  const target = Compiler.conditionalExportTarget(props.declaration, props.conditions)

  test("Физическая цель", () => {
    expect(target, "Порядок условий выбирает публичный файл владельца для конкретной среды").toBe(props.expected)
  })
})
