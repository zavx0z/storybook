import {describe, expect, test} from "bun:test"
import url from "@route/url"

describe.each([
  {name: "Пакет без области", props: {packageId: "button", route: ""}, path: "/pkg-button/"},
  {name: "Пакет с областью", props: {packageId: "@fixture/button", route: "dir-controls"}, path: "/pkg-fixture-button/dir-controls"},
])("$name", ({props, path}) => {
  const result = url.storybookPackageUrlPath(props.packageId, props.route)

  test("Публичный путь", () => {
    expect(result, "Страница использует читаемый сегмент package identity и сохраняет структурный путь")
      .toBe(path)
  })

  test("Маршрут известного пакета", () => {
    expect(url.storybookPackageRouteFromPathname(result, props.packageId),
      "Разбор возвращает маршрут только внутри указанного пакета")
      .toBe(props.route)
  })
})
