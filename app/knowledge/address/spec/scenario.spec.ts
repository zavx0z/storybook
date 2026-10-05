import {describe, expect, test} from "bun:test"
import resolveMcpAddress from "@zavx0z/storybook-app-knowledge-address"

const paths = ["storybook", "storybook/package", "storybook/package/documentation", "library.v2"]

describe.each([
  {name: "Корневой пакет", props: {address: "storybook", paths}},
  {name: "Вложенный пакет", props: {address: "storybook/package", paths}},
  {name: "Функция пакета", props: {address: "storybook/package/documentation", paths}},
  {name: "Точка в имени", props: {address: "library.v2", paths}},
  {name: "Явно относительный путь", props: {address: "./storybook/package", paths}},
])("$name", ({props}) => {
  const result = resolveMcpAddress(props)
  test("Адрес совпадает с выбранным направлением", () => {
    expect(result, "Начальный ./ отделяется от внутреннего адреса; точки внутри имени сохраняются").toBe(props.address.replace(/^\.\//u, ""))
  })
})
