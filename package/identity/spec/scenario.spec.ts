import {describe, expect, test} from "bun:test"
import identity from "@zavx0z/storybook-package-identity"

describe.each([
  {name: "Имя без области", props: {name: "button", exportName: "default"}},
  {name: "Имя с областью", props: {name: "@fixture/button", exportName: "Button"}},
])("$name", ({props}) => {
  const packageName = identity.package(props.name, "package.json name")
  const exportedName = identity.export(props.exportName, "module export")

  test("Точное имя пакета", () => {
    expect(packageName, "Имя пакета сохраняет область и регистр исходного package.json без преобразования в маршрут")
      .toBe(props.name)
  })

  test("Импортируемое имя экспорта", () => {
    expect(exportedName, "Публичный экспорт сохраняет имя, которым его импортирует потребитель")
      .toBe(props.exportName)
  })
})
