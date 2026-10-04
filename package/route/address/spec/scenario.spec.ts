import {describe, expect, test} from "bun:test"
import address from "@storybook-package-route/address"

describe.each([
  {
    name: "Начало пакета",
    props: {node: "storybook", view: "overview" as const},
    expected: "/storybook",
  },
  {
    name: "Сценарий с вариантом",
    props: {node: "storybook/узлы", view: "scenarios" as const, variant: "Круг"},
    expected: "/storybook/%D1%83%D0%B7%D0%BB%D1%8B?view=scenarios&variant=%D0%9A%D1%80%D1%83%D0%B3",
  },
])("$name", ({props, expected}) => {
  const result = address(props)
  const variant = "variant" in props ? props.variant : undefined

  test("Адрес страницы", () => {
    expect(result, "Каждый сегмент кодируется отдельно, а выбор представления и варианта остаётся в query")
      .toBe(expected)
  })

  test("Состав обратного маршрута", () => {
    expect(address.parseRoute(result), "Публичный разбор восстанавливает структурные сегменты и выбранные параметры")
      .toEqual({
        segments: props.node.split("/"),
        ...(props.view === "overview" ? {} : {view: props.view}),
        ...(variant === undefined ? {} : {variant}),
      })
  })
})
