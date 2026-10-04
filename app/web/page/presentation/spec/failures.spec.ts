import {describe, expect, test} from "bun:test"
import {createDocument} from "@immersive/dom"
import type {CompiledTemplate} from "@immersive/template/compiled"
import createPresentation from "@storybook-app-web-page/presentation"
import {PresentationExample, MultipleRoots} from "./fixture/view"

describe.each([
  {name: "Неверный selector", props: {template: PresentationExample, selector: "["}, expected: /selector|Selector|Expected|Invalid|Unexpected|attribute/i},
  {name: "Несколько корней", props: {template: MultipleRoots, selector: "[data-presentation-example]"}, expected: /received 2/},
  {name: "Корень отсутствует", props: {template: PresentationExample, selector: "[data-missing]"}, expected: /received 0/},
])("$name", ({props, expected}) => {
  const document = createDocument()
  test("Отказ вместо неоднозначного представления", () => {
    expect(() => createPresentation(document, props.template as unknown as CompiledTemplate<{label: string}>, {label: "Пример"}, props.selector),
      "Публичная factory отклоняет неверный selector или неправильное число выбранных корней").toThrow(expected)
  })
})
